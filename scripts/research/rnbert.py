"""Isolated RNBert research runner; pinned sources are in rnbert-sources.json.

Prepare inputs: npx tsx scripts/compare-rnbert.ts --prepare
Run setup in an isolated Linux/WSL Python environment and install its emitted
requirements plus pinned musicbert_hf checkout. Capture/predict/decode read no
reference labels. fit-quality reads only explicitly admitted training references;
decode applies that frozen fit to admitted development captures. map supports the
official prediction path. Independent evaluation: compare-rnbert.ts --evaluate.
"""
import argparse
import ast
import collections
import csv
import datetime
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.request
import warnings
from typing import Literal

WORKSPACE = pathlib.Path(__file__).resolve().parents[2]
SOURCES = json.loads(pathlib.Path(__file__).with_name('rnbert-sources.json').read_text())
ROOT = WORKSPACE / '.audit/contextual/rnbert'


def sticky_viterbi(probabilities, alpha, pbar=True):
    """Upstream float32 key DP, vectorized over states with identical tie order."""
    import numpy as np
    import torch
    if alpha == 1:
        return torch.argmax(probabilities, axis=-1)
    if probabilities.dtype != torch.float32 or probabilities.device.type != 'cpu':
        raise ValueError('Research key decoder expects upstream CPU float32 probabilities.')
    length, states = probabilities.shape
    transition = torch.ones((states, states))
    transition[range(states), range(states)] *= alpha
    transition /= transition.sum(axis=0, keepdims=True)
    transition = torch.log(transition).numpy()
    emission = torch.log(probabilities).numpy()
    previous = emission[0]
    back = np.empty((length - 1, states), dtype=np.int64)
    for i in range(1, length):
        candidates = (previous[:, None] + transition) + emission[i][None, :]
        back[i - 1] = np.argmax(candidates, axis=0)
        previous = candidates[back[i - 1], np.arange(states)]
        if not np.all(previous > -1e10):
            raise ValueError('Key path exhausted upstream numerical score range.')
    state = int(np.argmax(previous)); path = [state]
    for i in range(length - 2, -1, -1):
        state = int(back[i, state]); path.append(state)
    return torch.tensor(path[::-1])


def check_key_decoder():
    import torch
    from musicbert_hf.utils.sticky_viterbi import sticky_viterbi as upstream
    generator = torch.Generator().manual_seed(0)
    count = 0
    for alpha in (.9, 1., 1.2, 10.):
        for values in (torch.full((8, 4), .25), torch.softmax(torch.randn(15, 7, generator=generator), -1)):
            if not torch.equal(upstream(values, alpha, pbar=False), sticky_viterbi(values, alpha)):
                raise ValueError('Vectorized key decoder differs from pinned upstream.')
            count += 1
    return count


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(name, data):
    (ROOT / name).write_text(json.dumps(data, indent=2) + '\n')


def download(url, path, expected):
    if not path.exists():
        temporary = path.with_suffix(path.suffix + '.download')
        with urllib.request.urlopen(url) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if digest(temporary) != expected:
            raise ValueError(f'Download hash mismatch: {url}')
        temporary.rename(path)
    if digest(path) != expected:
        raise ValueError(f'Cached hash mismatch: {path}; retained for inspection.')


def setup(device):
    ROOT.mkdir(parents=True, exist_ok=True)
    repo = ROOT / 'musicbert_hf'
    if not repo.exists():
        subprocess.run(['git', 'clone', '--no-checkout', SOURCES['code']['url'], str(repo)], check=True)
        subprocess.run(['git', '-C', str(repo), 'checkout', SOURCES['code']['commit']], check=True)
    head = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    if head != SOURCES['code']['commit']:
        raise ValueError('Existing research checkout is not the pinned source revision.')

    def original(path):
        return subprocess.check_output(['git', '-C', str(repo), 'show', f'{head}:{path}']).decode()

    predictor = original('scripts/predict.py')
    if hashlib.sha256(predictor.encode()).hexdigest() != SOURCES['code']['predictSha256']:
        raise ValueError('Pinned predictor hash mismatch.')
    predictor = predictor.replace('DEBUG = True', 'DEBUG = False')
    helper = '''
import random
import numpy as np
sys.path.insert(0, RESEARCH_PATH)
from rnbert import sticky_viterbi
random.seed(0)
np.random.seed(0)
torch.manual_seed(0)

def research_forward(model, **inputs):
    output = model(**{key: value.to(RESEARCH_DEVICE) for key, value in inputs.items()})
    values = output.logits
    output.logits = values.detach().cpu() if isinstance(values, torch.Tensor) else type(values)(value.detach().cpu() for value in values)
    return output

'''.replace('RESEARCH_DEVICE', repr(device)).replace('RESEARCH_PATH', repr(str(pathlib.Path(__file__).parent)))
    if predictor.count('@dataclass') != 1:
        raise ValueError('Predictor adapter anchor changed.')
    predictor = predictor.replace('@dataclass', helper + '@dataclass', 1)
    for name in ['key_model', 'harmony_onset_model', 'rn_model']:
        if predictor.count(f'{name}.eval()') != 1 or predictor.count(f'outputs = {name}(') != 1:
            raise ValueError('Predictor model adapter anchor changed.')
        predictor = predictor.replace(f'{name}.eval()', f'{name}.eval().to({device!r})')
        predictor = predictor.replace(f'outputs = {name}(', f'outputs = research_forward({name},')
    (repo / 'scripts/predict.py').write_bytes(predictor.encode())
    reader = original('musicbert_hf/utils/read.py')
    if reader.count('df = read(path)') != 1:
        raise ValueError('Reader adapter anchor changed.')
    reader = reader.replace('df = read(path)', 'df = read(path, overlapping_notes="end_first") if path.endswith(".mid") else read(path)')
    (repo / 'musicbert_hf/utils/read.py').write_bytes(reader.encode())

    models = ROOT / 'models'; models.mkdir(exist_ok=True)
    for asset in SOURCES['models']['files']:
        download(asset['url'], models / asset['name'], asset['sha256'])
    download(SOURCES['translation']['url'], ROOT / 'harmony-chords-upstream.py', SOURCES['translation']['sha256'])
    download(SOURCES['training']['url'], ROOT / 'training-paths.txt', SOURCES['training']['sha256'])
    config = json.loads(original('supporting_files/rnbert_config.json'))
    for key, value in list(config.items()):
        if key.endswith('_path'):
            config[key] = str(models / pathlib.Path(value).name)
    config['make_pdf'] = False; save('config.json', config)
    requirements = [line for line in original('requirements-predict.txt').splitlines() if not line.startswith('-e git+')]
    (ROOT / 'requirements.txt').write_text('\n'.join(requirements) + '\n')
    save('model-manifest.json', {**SOURCES['models'], 'retrievedDate': str(datetime.date.today())})
    save('runtime-manifest.json', {'sourceCommit': head, 'device': device,
        'runtimePredictSha256': digest(repo / 'scripts/predict.py'), 'readerSha256': digest(repo / 'musicbert_hf/utils/read.py'),
        'runtimeChanges': ['Disable interactive debugger', 'Seed Python/NumPy/Torch at zero',
                           'Move model and forward inputs to requested device, return logits to CPU',
                           'Vectorize the same float32 key Viterbi state updates with original tie order',
                           'Use documented FIFO MIDI pairing; require independent event admission'],
        'modelInputProjection': 'Zero-duration grace exclusion; upstream 16 ticks/quarter quantization, detremolo, salami slicing and dedoubling.',
        'evaluation': 'Training-overlap development diagnostic; no supplied keys or chord boundaries.'})
    print(f'Setup files ready in {ROOT}. Install requirements in an isolated environment; no packages installed by this command.')


def admissions():
    rows = json.loads((ROOT / 'admission.json').read_text())['works']
    if sorted(r['work'] for r in rows) != sorted(SOURCES['developmentWorks']):
        raise ValueError('Admission must contain exactly the declared development works.')
    if any(r['split'] != 'development' for r in rows):
        raise ValueError('Heldout inputs are unavailable.')
    return rows


def check_inputs():
    from music_df.read import read
    checks = []
    for row in admissions():
        path = WORKSPACE / row['projection']; expected_path = WORKSPACE / row['expectedPath']
        if digest(path) != row['sha256'] or digest(expected_path) != row['expectedSha256']:
            raise ValueError('Projected input changed since admission.')
        df = read(str(path), overlapping_notes='end_first'); ppq = row['ppq']
        def key(pitch, onset, release, track):
            start, end = onset * ppq, release * ppq
            if abs(start - round(start)) > 1e-8 or abs(end - round(end)) > 1e-8:
                raise ValueError('Parser changed exact source timing.')
            return int(pitch), round(start), round(end), int(track)
        observed = collections.Counter(key(r.pitch, r.onset, r.release, r.track) for r in df.itertuples() if r.type == 'note')
        expected = collections.Counter(key(r['pitch'], r['onset'], r['release'], r['track']) for r in json.loads(expected_path.read_text()))
        if observed != expected:
            raise ValueError(f"Parser event mismatch: {row['work']}; missing {expected-observed}, extra {observed-expected}")
        checks.append({'work': row['work'], 'expected': expected.total(), 'observed': observed.total(), 'missing': [], 'extra': []})
    save('parser-admission.json', {'policy': 'Positive source pitch/onset/release/track multiset equality before model preprocessing; zero-duration exclusion and FIFO pairing declared.', 'checks': checks})
    print(json.dumps(checks))


def predict(profile, onset_threshold):
    import torch
    check_inputs()
    for asset in SOURCES['models']['files']:
        if digest(ROOT / 'models' / asset['name']) != asset['sha256']:
            raise ValueError('Checkpoint/vocabulary hash mismatch.')
    config = json.loads((ROOT / 'config.json').read_text())
    if onset_threshold is not None:
        config['harmony_onset_threshold'] = onset_threshold
    threshold = config.get('harmony_onset_threshold', 0.3)
    if profile == 'baseline' and threshold != 0.3:
        raise ValueError('Use a named --profile for a changed onset threshold; baseline stays upstream 0.3.')
    config_name = f'config-{profile}.json'; save(config_name, config)
    timings = []
    for row in admissions():
        start = time.perf_counter(); work = row['work']; suffix = 'admitted' if profile == 'baseline' else profile
        log = ROOT / f'{work}-{suffix}.log'
        with log.open('w') as output:
            subprocess.run([sys.executable, str(ROOT / 'musicbert_hf/scripts/predict.py'), '--config', str(ROOT / config_name),
                            '--input-path', str(WORKSPACE / row['projection']), '--output-folder', str(ROOT / f'{work}-{suffix}')],
                           cwd=ROOT / 'musicbert_hf', stdout=output, stderr=subprocess.STDOUT, check=True)
        seconds = time.perf_counter() - start
        with log.open('a') as output:
            output.write(f'\nelapsed_seconds={seconds}\n')
        timings.append({'work': work, 'seconds': seconds}); print(json.dumps(timings[-1]), flush=True)
    save(f'inference-runtime-{profile}.json', {'profile': profile, 'onsetThreshold': threshold,
        'configSha256': digest(ROOT / config_name), 'predictorSha256': digest(ROOT / 'musicbert_hf/scripts/predict.py'),
        'readerSha256': digest(ROOT / 'musicbert_hf/musicbert_hf/utils/read.py'),
        'torch': torch.__version__, 'cuda': torch.version.cuda,
        'gpu': torch.cuda.get_device_name() if torch.cuda.is_available() else None, 'works': timings})


def capture(admission_path, profile, shifts):
    """Capture the official forward once per admitted source/shift, without labels.

    Hooks observe the trained degree/quality heads and raw RN outputs; upstream owns
    model execution, overlap collation and salami-slice pooling. Source-event
    admission precedes upstream quantization. No reference harmony enters here.
    """
    import random
    import mido
    import numpy as np
    import pandas as pd
    import torch
    from music_df.read import read
    from musicbert_hf.decoding_helpers import get_key

    admission_path = pathlib.Path(admission_path).resolve()
    admission = json.loads(admission_path.read_text())
    rows = admission['works']
    registry_path = WORKSPACE / 'docs/research/corpus-candidates.json'
    registry = json.loads(registry_path.read_text())
    registered = [w for source in registry['evaluationSources'] for w in source.get('works', [])]
    if not rows or len({r['work'] for r in rows}) != len(rows):
        raise ValueError('Capture admission must contain distinct works.')
    for row in rows:  # Check every role before opening any music payload.
        matches = [w for w in registered if w['id'] == row['work']]
        if (not re.fullmatch(r'[a-zA-Z0-9_-]+', row['work']) or len(matches) != 1
                or row['split'] not in ('training', 'development') or matches[0]['split'] != row['split']):
            raise ValueError('Capture admits explicitly registered training/development works only.')
        if not isinstance(row['ppq'], int) or isinstance(row['ppq'], bool) or row['ppq'] <= 0:
            raise ValueError('Source PPQ must be a positive integer.')
    if (not shifts or len(set(shifts)) != len(shifts)
            or any(not isinstance(s, int) or isinstance(s, bool) or not -127 <= s <= 127 for s in shifts)):
        raise ValueError('Capture shifts must be distinct integer semitones in [-127,127].')
    if profile == 'baseline' or not re.fullmatch(r'[a-z0-9][a-z0-9._-]*', profile):
        raise ValueError('Capture requires its own named profile.')
    runtime = json.loads((ROOT / 'runtime-manifest.json').read_text())
    source = ROOT / 'musicbert_hf/scripts/predict.py'
    if digest(source) != runtime['runtimePredictSha256']:
        raise ValueError('Installed predictor differs from the setup manifest.')
    if digest(ROOT / 'musicbert_hf/musicbert_hf/utils/read.py') != runtime['readerSha256']:
        raise ValueError('Installed source reader differs from the setup manifest.')
    for asset in SOURCES['models']['files']:
        if digest(ROOT / 'models' / asset['name']) != asset['sha256']:
            raise ValueError('Checkpoint/vocabulary hash mismatch.')
    head = subprocess.check_output(['git', '-C', str(ROOT / 'musicbert_hf'), 'rev-parse', 'HEAD'], text=True).strip()
    if head != SOURCES['code']['commit']:
        raise ValueError('Capture source checkout is not pinned.')
    spec = importlib.util.spec_from_file_location('rnbert_capture_predictor', source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    torch.set_num_threads(4)
    state, models, handles = {}, {}, []
    conditioned_loader = 'load_musicbert_multitask_token_classifier_with_conditioning_from_fairseq_checkpoint'
    for name in ('load_musicbert_token_classifier_from_fairseq_checkpoint', conditioned_loader):
        original = getattr(module, name)

        def cached(*args, _original=original, _conditioned=name == conditioned_loader, **kwargs):
            key = json.dumps([_original.__name__, args, kwargs], sort_keys=True)
            if key not in models:
                model = _original(*args, **kwargs)
                models[key] = model
                if _conditioned:
                    targets = list(json.loads((ROOT / 'config.json').read_text())['rn_target_names'])
                    state['model'], state['readoutHeads'] = model, {}
                    for label, target, count in [('quality', 'quality', 15), ('degree', degree_name, 193)]:
                        if targets.count(target) != 1:
                            raise ValueError(f'{label} head identity is ambiguous.')
                        readout = model.classifier.multi_tag_sub_heads[targets.index(target)].out_proj
                        if tuple(readout.weight.shape) != (count, 1024):
                            raise ValueError(f'Pinned {label} readout shape changed.')
                        state['readoutHeads'][label] = readout
                        handles.append(readout.register_forward_pre_hook(
                            lambda _head, inputs, label=label: state['features'][label].extend(inputs[0].detach().cpu())))
            return models[key]

        setattr(module, name, cached)
    forward, onset_mask = module.research_forward, module.get_onset_mask

    def observed_forward(model, **inputs):
        output = forward(model, **inputs)
        if model is state.get('model'):
            if list(model.config.targets) != state['targets']:
                raise ValueError('RN head identities changed.')
            for target, values in zip(model.config.targets, output.logits):
                state['raw'][target].extend(values.detach().cpu())
            state['masks'].extend(inputs['attention_mask'].detach().cpu())
        return output

    def observed_mask(logits, dataset, stoi):
        state['keys'] = dataset.raw_key_indices.detach().cpu().clone()
        state['slices'] = [v.detach().cpu().clone() for v in dataset.slice_ids]
        state['onsetLogits'], state['onsetVocabulary'] = logits.detach().cpu().clone(), dict(stoi)
        return onset_mask(logits, dataset, stoi)

    module.research_forward, module.get_onset_mask = observed_forward, observed_mask
    targets = json.loads((ROOT / 'config.json').read_text())['rn_target_names']
    degree_name = 'primary_alteration_primary_degree_secondary_alteration_secondary_degree'
    named_heads = {'degree': degree_name, 'quality': 'quality', 'inversion': 'inversion'}
    destination = ROOT / f'capture-{profile}'
    destination.mkdir(parents=True, exist_ok=True)
    runner_source = pathlib.Path(__file__).read_bytes()
    snapshot = destination / 'runner-source.py'
    if snapshot.exists() and snapshot.read_bytes() != runner_source:
        raise ValueError('Capture profile uses another runner revision; use a new profile.')
    snapshot.write_bytes(runner_source)
    provenance = {'methodSha256': digest(pathlib.Path(__file__)), 'admissionPath': str(admission_path),
        'admissionSha256': digest(admission_path), 'registrySha256': digest(registry_path),
        'predictorSha256': digest(source), 'readerSha256': runtime['readerSha256'], 'sourceCommit': head,
        'configSha256': digest(ROOT / 'config.json'), 'models': SOURCES['models']['files'],
        'torch': torch.__version__, 'numpy': np.__version__, 'device': runtime['device'],
        'cuda': torch.version.cuda, 'seedPerQuery': 0, 'threads': 4, 'modelPpq': 48,
        'upstreamProjection': '16ticks/quarter quantization, detremolo, salami slicing and dedoubling; source-event equality is checked before these operations.'}

    def event_key(pitch, onset, release, track, ppq, shift=0):
        start, end = float(onset) * ppq, float(release) * ppq
        if not np.isfinite([start, end]).all() or abs(start-round(start)) > 1e-8 or abs(end-round(end)) > 1e-8:
            raise ValueError('Source parser changed exact timing.')
        return int(pitch)-shift, round(start), round(end), int(track)

    results = []
    try:
        for row in rows:
            midi_path, expected_path = WORKSPACE / row['projection'], WORKSPACE / row['expectedPath']
            if digest(midi_path) != row['sha256'] or digest(expected_path) != row['expectedSha256']:
                raise ValueError('Input admission hash mismatch.')
            expected = json.loads(expected_path.read_text())
            expected_events = collections.Counter(event_key(r['pitch'], r['onset'], r['release'], r['track'], row['ppq']) for r in expected)
            original = read(str(midi_path), overlapping_notes='end_first')
            actual = collections.Counter(event_key(r.pitch, r.onset, r.release, r.track, row['ppq']) for r in original.itertuples() if r.type == 'note')
            if actual != expected_events:
                raise ValueError('Source input differs from admitted event multiset.')
            geometry = None
            for shift in shifts:
                started = time.perf_counter()
                output = destination / f'{row["work"]}-shift-{shift}'
                output.mkdir(exist_ok=True)
                if (output / 'manifest.json').exists():
                    previous = json.loads((output / 'manifest.json').read_text())
                    if (any(previous.get(k) != v for k, v in provenance.items())
                            or previous.get('work') != row['work'] or previous.get('split') != row['split']
                            or previous.get('shift') != shift or previous.get('sourceInputSha256') != row['sha256']
                            or previous.get('expectedSha256') != row['expectedSha256']
                            or any(digest(output / name) != value for name, value in previous['files'].items())):
                        raise ValueError('Existing capture provenance changed; use a new profile.')
                    intervals = [(f['startTick'], f['endTick']) for f in json.loads((output / 'frames.json').read_text())]
                    if geometry is not None and intervals != geometry:
                        raise ValueError('Cached transposition changed atomic model intervals.')
                    geometry = intervals
                    results.append({'work': row['work'], 'split': row['split'], 'shift': shift,
                        'path': str(output), 'sha256': digest(output / 'manifest.json')})
                    print(json.dumps({'work': row['work'], 'shift': shift, 'reusedVerifiedCapture': True}), flush=True)
                    continue
                if shift:
                    midi = mido.MidiFile(midi_path)
                    for track in midi.tracks:
                        for event in track:
                            if event.type in ('note_on', 'note_off', 'polytouch'):
                                event.note += shift
                                if not 0 <= event.note <= 127:
                                    raise ValueError('Transposition leaves MIDI pitch range.')
                    input_path = output / 'input.mid'
                    midi.save(input_path)
                else:
                    input_path = midi_path  # Preserve exact zero-query input bytes.
                transposed = read(str(input_path), overlapping_notes='end_first')
                actual = collections.Counter(event_key(r.pitch, r.onset, r.release, r.track, row['ppq'], shift) for r in transposed.itertuples() if r.type == 'note')
                if actual != expected_events:
                    raise ValueError('Transposition changed the admitted event multiset.')
                state.update(targets=targets, features={'quality': [], 'degree': []}, masks=[], raw={t: [] for t in targets})
                random.seed(0); np.random.seed(0); torch.manual_seed(0)
                config = module.load_config_from_json(str(ROOT / 'config.json'), str(input_path), str(output))
                config.harmony_onset_threshold = .01  # Raw captures precede pooling; fixed display output only.
                module.config = config
                module.main(config)
                slices = module.collate_slice_ids(state['slices'], overlap_size=config.window_size-config.hop_size-2, check_overlap=True)
                def collate(values):
                    return module.collate_logits(values, overlap_size=config.window_size-config.hop_size,
                        attention_masks=state['masks'], trim_start=False, trim_end=False)[..., 1:-1, :]
                features = {name: collate(values) for name, values in state['features'].items()}
                notes = pd.read_csv(output / 'annotated_music_df.csv')
                notes = notes[notes.type == 'note'].reset_index(drop=True)
                if slices.tolist() != notes.distinct_slice_id.astype(int).tolist() or any(h.shape != (len(notes), 1024) for h in features.values()):
                    raise ValueError('Captured rows/slice IDs/features are misaligned.')
                atomic_ids = torch.tensor(pd.factorize(notes.slice_id, sort=False)[0])
                atom = lambda values: module.sync_slices(values, atomic_ids, return_per_slice=True)
                raw, full, vocabularies, logits = {}, {}, {}, {}
                model = state['model']
                for target in targets:
                    full[target] = collate(state['raw'][target])
                    if not torch.isfinite(full[target]).all():
                        raise ValueError('Captured logits contain nonfinite values.')
                    if target in named_heads.values():
                        values, stoi = module.drop_specials(full[target], model.config.multitask_label2id[target])
                        name = next(k for k, v in named_heads.items() if v == target)
                        raw[name], logits[name] = values, atom(values)
                        vocabularies[name] = [k for k, v in sorted(stoi.items(), key=lambda item: item[1])]
                captured_readouts, raw_readouts, readout_checks = {}, {}, {}
                for name, features_for_head in features.items():
                    readout = state['readoutHeads'][name]
                    weight, bias = readout.weight.detach().cpu().clone(), readout.bias.detach().cpu().clone()
                    stoi = model.config.multitask_label2id[named_heads[name]]
                    columns = [stoi[t] for t in vocabularies[name]]
                    if columns != list(range(4, weight.shape[0])):
                        raise ValueError(f'Pinned {name} nonspecial columns changed.')
                    atomic_features = atom(features_for_head)
                    replay = torch.nn.functional.linear(atomic_features, weight, bias)
                    atomic_raw = atom(full[named_heads[name]])
                    if (not torch.isfinite(atomic_features).all() or not torch.allclose(replay, atomic_raw, atol=3e-5, rtol=1e-5)
                            or not torch.equal(replay.argmax(-1), atomic_raw.argmax(-1))):
                        raise ValueError(f'Captured linear {name} readout does not reproduce logits.')
                    captured_readouts.update({f'{name}Features': atomic_features, f'{name}Weight': weight[columns], f'{name}Bias': bias[columns]})
                    raw_readouts.update({f'{name}Features': features_for_head, f'{name}Weight': weight, f'{name}Bias': bias})
                    readout_checks.update({f'{name}ReplayMaxAbs': float((replay-atomic_raw).abs().max()), f'{name}ReplayArgmaxDifferences': 0})
                key_stoi = model.config.multitask_label2id['key_pc_mode']
                key_tokens = {v: k for k, v in key_stoi.items() if v >= 0}
                onset_probability = torch.softmax(state['onsetLogits'], -1)[:, state['onsetVocabulary']['yes']]
                frames, seen_ids = [], set()
                for _, group in notes.groupby('slice_id', sort=False):
                    if group.onset.nunique() != 1 or group.release.nunique() != 1 or group.distinct_slice_id.nunique() != 1:
                        raise ValueError('Atomic source frame is not a uniform interval.')
                    start, end = float(group.onset.iloc[0])*48, float(group.release.iloc[0])*48
                    if not start.is_integer() or not end.is_integer() or not 0 <= start < end:
                        raise ValueError('Atomic frame cannot be represented at model PPQ48.')
                    index = int(group.distinct_slice_id.iloc[0])
                    key = get_key(key_tokens[int(state['keys'][index])]).rstrip('.')
                    frames.append({'startTick': int(start), 'endTick': int(end), 'key': key,
                        'onsetProbability': float(onset_probability[index]) if index not in seen_ids else None})
                    seen_ids.add(index)
                intervals = [(f['startTick'], f['endTick']) for f in frames]
                if geometry is not None and intervals != geometry:
                    raise ValueError('Transposition changed atomic model intervals.')
                geometry = intervals
                if any(len(frames) != captured_readouts[f'{name}Features'].shape[0] for name in features):
                    raise ValueError('Atomic frame count differs from feature rows.')
                bundle = {'frames': frames, 'ppq': 48, 'vocabularies': vocabularies, 'logits': logits,
                    **captured_readouts}
                torch.save(bundle, output / 'capture.pt')
                torch.save({'rawHeads': full, **raw_readouts,
                    'sliceIds': slices, 'keyIndices': state['keys'], 'onsetLogits': state['onsetLogits'],
                    'dictionaries': model.config.multitask_label2id}, output / 'raw.pt')
                (output / 'frames.json').write_text(json.dumps(frames, separators=(',', ':')) + '\n')
                (output / 'vocabularies.json').write_text(json.dumps(vocabularies, indent=2) + '\n')
                files = {p.name: digest(p) for p in sorted(output.iterdir()) if p.is_file()}
                result = {**provenance, 'work': row['work'], 'split': row['split'], 'shift': shift,
                    'sourcePpq': row['ppq'], 'sourceInputSha256': row['sha256'], 'inputSha256': digest(input_path),
                    'expectedSha256': row['expectedSha256'], 'exactSourceEvents': expected_events.total(),
                    'rows': len(notes), 'frames': len(frames), 'files': files,
                    **readout_checks, 'seconds': time.perf_counter()-started,
                    'targetLabelsRead': False, 'featureMeaning': 'Atomic means of separate official overlap-collated degree and quality dense+tanh outputs; original final linear readouts retained.'}
                (output / 'manifest.json').write_text(json.dumps(result, indent=2) + '\n')
                results.append({'work': row['work'], 'split': row['split'], 'shift': shift,
                    'path': str(output), 'sha256': digest(output / 'manifest.json')})
                print(json.dumps({'work': row['work'], 'shift': shift, 'rows': len(notes), 'frames': len(frames), 'seconds': result['seconds']}), flush=True)
        report = {**provenance, 'profile': profile, 'shifts': shifts, 'targetLabelsRead': False, 'works': results}
        (destination / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
        return report
    finally:
        for handle in handles:
            handle.remove()
        sys.modules.pop(spec.name, None)


def mapper():
    import mspell
    from music21.harmony import ChordSymbol
    from music21.roman import RomanNumeral, Minor67Default
    from musicbert_hf.decoding_helpers import MAJOR_KEYS, MINOR_KEYS
    source = ROOT / 'harmony-chords-upstream.py'
    if digest(source) != SOURCES['translation']['sha256']:
        raise ValueError('Translator source hash mismatch.')
    tree = ast.parse(source.read_text())
    names = ['_translate_single_rnbert_part', 'translate_rns', 'tonicization_to_key']
    nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in names)
             or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ['TONICIZATIONS', 'MODES'] for t in n.targets))]
    namespace = {'re': re, 'warnings': warnings, 'Literal': Literal, 'UNSPELLER': mspell.Unspeller(), 'MAJOR_KEYS': MAJOR_KEYS, 'MINOR_KEYS': MINOR_KEYS}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)

    # The upstream display token keeps quality and inversion separately. Roman
    # numerals alone can infer a different seventh from the local key, so use
    # the explicit predicted quality to realize the core after resolving root.
    quality_intervals = {'M': (0, 4, 7), 'm': (0, 3, 7), 'o': (0, 3, 6), '+': (0, 4, 8),
                         'M7': (0, 4, 7, 11), 'Mm7': (0, 4, 7, 10), 'm7': (0, 3, 7, 10),
                         'o7': (0, 3, 6, 9), 'ø7': (0, 3, 6, 10)}

    def parse(rn, key):
        if any(token in rn for token in ['aug6', 'x', '?', '<']):
            raise ValueError('Unknown/collapsed augmented-sixth class is not uniquely reconstructible.')
        pieces = rn.split('/'); local_key = key
        if len(pieces) > 2:
            raise ValueError('Multiple tonicizations unavailable in model vocabulary.')
        if len(pieces) == 2:
            secondary = pieces[1]
            if secondary != 'I' and secondary not in namespace['TONICIZATIONS']['M' if key[0].isupper() else 'm']:
                raise ValueError('Unrecognized secondary degree.')
            local_key = namespace['tonicization_to_key'](secondary, key, case_matters=False)
        token = re.fullmatch(r'[b#]*(?:VII|VI|IV|V|III|II|I)(Mm|M|m|o|ø|\+)(7|65|43|42|64|6)?', pieces[0])
        if token is None:
            raise ValueError('Unknown explicit quality or inversion.')
        quality = token[1] + ('7' if token[2] in ('7', '65', '43', '42') else '')
        if quality not in quality_intervals:
            raise ValueError('Quality/inversion combination unavailable in model vocabulary.')
        translated = namespace['translate_rns'](pieces[0])
        roman = RomanNumeral(translated, local_key, sixthMinor=Minor67Default.CAUTIONARY, seventhMinor=Minor67Default.CAUTIONARY)
        root = int(roman.root().pitchClass)
        return {'translated': translated, 'localKey': local_key, 'root': root,
                'core': sorted((root + interval) % 12 for interval in quality_intervals[quality])}

    controls = [('IM','C',0,[0,4,7]),('VMm7','C',7,[2,5,7,11]),('VMm65','A',4,[2,4,8,11]),('IM64','C',0,[0,4,7]),
                ('VIIo7','C',11,[2,5,8,11]),('#VIIo7','a',8,[2,5,8,11]),('VIm','C',9,[0,4,9]),('VMm7/IV','C',0,[0,4,7,10]),
                ('VIIo7/V','C',6,[0,3,6,9]),('VIIø43/V','A',3,[1,3,6,9]),('#VIIo7/VI','G',3,[0,3,6,9]),
                ('#VIIo7/VI','C',8,[2,5,8,11]),('#VIIo43/II','G',8,[2,5,8,11])]
    for rn, key, root, core in controls:
        result = parse(rn, key)
        if result['root'] != root or result['core'] != core:
            raise ValueError(f'Independent mapping control failed: {rn}, {key}, {result}')
    # Independent chord-symbol realization checks the full explicit-quality
    # cross product, including inversions and contexts that changed sevenths.
    symbols = {'M': 'C', 'm': 'Cm', 'o': 'Cdim', '+': 'C+', 'M7': 'Cmaj7',
               'Mm7': 'C7', 'm7': 'Cm7', 'o7': 'Cdim7', 'ø7': 'Cm7b5'}
    count = len(controls)
    for quality, symbol in symbols.items():
        expected = sorted(set(int(p) for p in ChordSymbol(symbol).pitchClasses))
        figures = ('7', '65', '43', '42') if '7' in quality else ('', '6', '64')
        for key in ('C', 'a', 'F#', 'eb'):
            for degree in ('I', 'II', 'III', 'IV', 'V', 'VI', 'VII'):
                for figure in figures:
                    rn = degree + quality.replace('7', '') + figure
                    result = parse(rn, key)
                    if sorted((pitch - result['root']) % 12 for pitch in result['core']) != expected:
                        raise ValueError(f'Explicit-quality control failed: {rn}, {key}, {result}')
                    count += 1
    for rn in ('Ix', 'Iaug67', 'I+7', 'Iø', 'IM?', 'IM/UNKNOWN'):
        try:
            parse(rn, 'C')
        except ValueError:
            count += 1
        else:
            raise ValueError(f'Unknown-label rejection control failed: {rn}')
    return parse, count


def map_predictions(profile):
    from music21.key import Key
    parse, control_count = mapper(); reports = []
    registry = json.loads((WORKSPACE / 'docs/research/corpus-candidates.json').read_text())
    registered = [w for source in registry['evaluationSources'] for w in source.get('works', [])]
    admitted = []
    for row in admissions():
        matches = [w for w in registered if w['id'] == row['work']]
        if len(matches) != 1 or matches[0]['split'] != 'development':
            raise ValueError('Mapping requires an independently registered development work.')
        source = matches[0]; midi = source['derivedScoreMidi']; score = source['derivedScore']
        if (row['sourceSha256'] != midi['sha256']
                or (WORKSPACE / row['source']).resolve() != (WORKSPACE / midi['path']).resolve()
                or row['ppq'] != source['scorePpq']):
            raise ValueError('Mapping admission belongs to a different registered score edition/timebase.')
        admitted.append((row, score))
    for row, score in admitted:
        if (digest(WORKSPACE / row['source']) != row['sourceSha256']
                or digest(WORKSPACE / row['projection']) != row['sha256']
                or digest(WORKSPACE / score['path']) != score['sha256']):
            raise ValueError('Mapping source/projection bytes changed after admission.')
        work = row['work']; suffix = 'admitted' if profile == 'baseline' else profile
        path = ROOT / f'{work}-{suffix}/chord_df.csv'; key = None; windows = []; unsupported = []
        for event in csv.DictReader(path.open()):
            key = event['key'] or key
            start = float(event['onset']) * row['ppq']; end = float(event['release']) * row['ppq']
            if not start.is_integer() or not end.is_integer() or end <= start:
                raise ValueError('Model output time is not exactly representable in source PPQ.')
            tonic = Key(key).tonic.pitchClass
            if not isinstance(tonic, int) or not 0 <= tonic < 12:
                raise ValueError('Predicted key tonic is not a 12TET pitch class.')
            window = {'startTick': int(start), 'endTick': int(end), 'selected': None, 'alternatives': [],
                      'modelKey': key, 'modelRn': event['rn'], 'tonicPitchClass': tonic * 100000}
            try:
                label = parse(event['rn'], key)
                window.update({'selected': 0, 'alternatives': [{'rootMillicents': label['root'] * 100000,
                    'coreIntervals': sorted(((p-label['root']) % 12) * 100000 for p in label['core']), 'colorIntervals': []}],
                    'translated': label['translated'], 'localKey': label['localKey']})
            except Exception as error:
                unsupported.append({'row': event, 'reason': str(error)})
            windows.append(window)
        output = f'{work}-predictions.json' if profile == 'baseline' else f'{work}-{profile}-predictions.json'
        save(output, {'windows': windows, 'work': work, 'ppq': row['ppq'],
                      'sourceScoreSha256': score['sha256'], 'targetLabelsRead': False})
        reports.append({'work': work, 'chordCsvSha256': digest(path), 'output': output, 'predictionSha256': digest(ROOT / output),
                        'sourceScoreSha256': score['sha256'], 'windowCount': len(windows), 'unsupported': unsupported})
    manifest = 'mapping-manifest.json' if profile == 'baseline' else f'mapping-manifest-{profile}.json'
    save(manifest, {**SOURCES['translation'], 'profile': profile, 'controls': control_count, 'results': reports,
        'mapperSha256': digest(pathlib.Path(__file__)), 'tonicPitchClassUnit': 'Native millicents modulo 1200000, from the predicted model key only.',
        'method': 'Author atomic translation plus tonicization_to_key(case_matters=False) resolves root with music21 9.3.0 CAUTIONARY minor6/7; explicit predicted quality supplies core intervals independently of local-key seventh defaults. I64 keeps realization root I. Unknown/lossy classes unavailable, denominator retained.',
        'secondaryModeLimit': 'Mode absent from model degree vocabulary; author diatonic-default heuristic supplies it, not new model evidence.'})
    print(json.dumps(reports))


def artifact_reference(path):
    """Portable manifest reference for artifacts inside this workspace."""
    path = pathlib.Path(path).resolve()
    try:
        return path.relative_to(WORKSPACE).as_posix()
    except ValueError:
        return str(path)


def readout_captures(manifest_path, split, admission_path=None, works=None):
    """Admit roles before payloads, then verify capture provenance and arrays."""
    import torch
    manifest_path = pathlib.Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text())
    admission_path = pathlib.Path(admission_path or manifest['admissionPath']).resolve()
    if digest(admission_path) != manifest['admissionSha256'] or manifest['targetLabelsRead'] is not False:
        raise ValueError('Capture admission or no-label contract changed.')
    admission = json.loads(admission_path.read_text())
    registry = json.loads((WORKSPACE / 'docs/research/corpus-candidates.json').read_text())
    registered = [w for source in registry['evaluationSources'] for w in source.get('works', [])]
    rows = admission['works']
    selected = list(works) if works else [r['work'] for r in rows]
    if not selected or len(set(selected)) != len(selected):
        raise ValueError('Choose distinct explicitly admitted works.')
    shifts = manifest['shifts']
    if not shifts or len(set(shifts)) != len(shifts) or (split == 'development' and shifts != [0]):
        raise ValueError('Training captures need declared shifts; development decoding requires original shift0.')
    admitted = []
    for work in selected:
        matches = [r for r in rows if r['work'] == work]
        sources = [w for w in registered if w['id'] == work]
        if len(matches) != 1 or len(sources) != 1 or matches[0]['split'] != split or sources[0]['split'] != split:
            raise ValueError(f'{work}: requested {split} role is not independently registered/admitted.')
        row, source = matches[0], sources[0]
        midi = source['derivedScoreMidi']
        if (row['sourceSha256'] != midi['sha256']
                or (WORKSPACE / row['source']).resolve() != (WORKSPACE / midi['path']).resolve()
                or row['ppq'] != source['scorePpq']):
            raise ValueError(f'{work}: capture admission belongs to a different registered score edition/timebase.')
        entries = [e for e in manifest['works'] if e['work'] == work]
        if len(entries) != len(shifts) or {e['shift'] for e in entries} != set(shifts) or any(e['split'] != split for e in entries):
            raise ValueError(f'{work}: incomplete or duplicate capture shifts.')
        admitted.append((row, source, entries))
    loaded = []
    for row, source, entries in admitted:
        if digest(WORKSPACE / row['source']) != row['sourceSha256'] or digest(WORKSPACE / row['projection']) != row['sha256']:
            raise ValueError('Admitted source/projection bytes changed.')
        score = source['derivedScore']
        if digest(WORKSPACE / score['path']) != score['sha256']:
            raise ValueError('Registry score bytes changed.')
        for shift in shifts:
            entry = next(e for e in entries if e['shift'] == shift)
            folder = pathlib.Path(entry['path'])
            if digest(folder / 'manifest.json') != entry['sha256']:
                raise ValueError('Per-capture manifest changed.')
            local = json.loads((folder / 'manifest.json').read_text())
            for key in ('admissionSha256', 'methodSha256', 'sourceCommit', 'models', 'configSha256'):
                if local[key] != manifest[key]:
                    raise ValueError('Capture provenance disagrees with its batch.')
            if (local['work'] != row['work'] or local['split'] != split or local['shift'] != shift
                    or local['sourceInputSha256'] != row['sha256'] or local['expectedSha256'] != row['expectedSha256']
                    or local['targetLabelsRead'] is not False):
                raise ValueError('Capture source identity changed.')
            for name, expected in local['files'].items():
                if pathlib.Path(name).name != name or digest(folder / name) != expected:
                    raise ValueError('Capture artifact hash/path mismatch.')
            bundle = torch.load(folder / 'capture.pt', map_location='cpu', weights_only=True)
            if bundle['frames'] != json.loads((folder / 'frames.json').read_text()) or bundle['vocabularies'] != json.loads((folder / 'vocabularies.json').read_text()):
                raise ValueError('Capture tensor/readable geometry or columns differ.')
            loaded.append({'work': row['work'], 'shift': shift, 'row': row, 'source': source, 'bundle': bundle,
                'capturePath': artifact_reference(folder), 'captureManifestSha256': entry['sha256'], 'captureSha256': local['files']['capture.pt']})
    return loaded, {'path': artifact_reference(manifest_path), 'sha256': digest(manifest_path),
                    'admissionPath': artifact_reference(admission_path), 'admissionSha256': digest(admission_path)}


def quality_capture(bundle):
    from rnbert_readout import QualityCapture
    return QualityCapture(bundle['frames'], bundle['ppq'], bundle['qualityFeatures'],
                          bundle['logits']['degree'], bundle['logits']['quality'], bundle['vocabularies'])


def readout_training_batches(manifest_paths, admission_path=None, works=None):
    """Compose independently admitted batches without rewriting their provenance."""
    paths = [pathlib.Path(p).resolve() for p in manifest_paths]
    if not paths or len(set(paths)) != len(paths):
        raise ValueError('Choose distinct capture manifests.')
    if admission_path and len(paths) != 1:
        raise ValueError('An admission override is only valid for one capture manifest.')
    if works is not None and (not works or len(set(works)) != len(works)):
        raise ValueError('Choose distinct explicitly admitted works.')
    loaded, provenance, identities, references, signature = [], [], set(), {}, None
    for path in paths:
        manifest = json.loads(path.read_text())
        available = list(dict.fromkeys(e['work'] for e in manifest['works']))
        selected = [w for w in works if w in available] if works is not None else available
        if not selected:
            continue
        rows, origin = readout_captures(path, 'training', admission_path, selected)
        current = {k: manifest[k] for k in ('sourceCommit', 'models', 'configSha256', 'modelPpq')}
        if signature is not None and current != signature:
            raise ValueError('Training batches use different model/configuration identities.')
        signature = current
        for row in rows:
            identity = (row['work'], row['shift'])
            if identity in identities:
                raise ValueError('Duplicate work/shift across training batches.')
            identities.add(identity)
            reference = row['row']['references']
            if row['work'] in references and references[row['work']] != reference:
                raise ValueError('Training reference identity differs across batches.')
            references[row['work']] = reference
        loaded.extend(rows); provenance.append(origin)
    if not loaded or (works is not None and set(works) != {r['work'] for r in loaded}):
        raise ValueError('Requested training works are missing from the capture manifests.')
    if works is not None:
        order = {work: i for i, work in enumerate(works)}
        loaded.sort(key=lambda row: order[row['work']])
    return loaded, provenance


def fit_quality(captures_path, admission_path, profile, works):
    import torch
    from rnbert_readout import CoreReference, QualityTrainingExample, RealizationVocabulary, fit_quality_readout, PROTOCOL
    rows, provenance = readout_training_batches(captures_path, admission_path, works)
    destination = ROOT / f'readout-{profile}'
    if destination.exists():
        raise ValueError('Fit profile already exists; choose a new name to preserve frozen outputs.')
    examples, reference_cache, inputs, weight, bias = [], {}, [], None, None
    for item in rows:
        b, row = item['bundle'], item['row']
        reference = row['references']; path = WORKSPACE / reference['path']
        if item['work'] not in reference_cache:
            if digest(path) != reference['sha256']:
                raise ValueError('Training reference hash changed.')
            labels = json.loads(path.read_text())
            if labels['work'] != item['work'] or labels['split'] != 'training' or labels['ppq'] != reference['ppq']:
                raise ValueError('Training reference role/timebase changed.')
            converted = []
            for r in labels['references']:
                core = None
                if not r.get('issue') and r.get('root') is not None:
                    if any(type(p) is not int or not 0 <= p < 1_200_000 or p % 100_000 for p in r['core']):
                        raise ValueError('Readout references require exact 12TET pitch-class cores.')
                    core = tuple(p // 100_000 for p in r['core'])
                converted.append(CoreReference(r['startTick'], r['endTick'], core))
            reference_cache[item['work']] = converted
        if weight is None:
            weight, bias = b['qualityWeight'], b['qualityBias']
        elif not torch.equal(weight, b['qualityWeight']) or not torch.equal(bias, b['qualityBias']):
            raise ValueError('Training captures use different pretrained quality readouts.')
        examples.append(QualityTrainingExample(quality_capture(b), reference_cache[item['work']], reference['ppq'], item['shift']))
        inputs.append({k: item[k] for k in ('work', 'shift', 'capturePath', 'captureManifestSha256', 'captureSha256')}
                      | {'reference': reference, 'sourceScoreSha256': item['source']['derivedScore']['sha256']})
    parse, controls = mapper(); semantics = RealizationVocabulary(examples[0].capture.vocabularies, parse)
    started = time.perf_counter()
    fit = fit_quality_readout(examples, semantics=semantics, readout_weight=weight, readout_bias=bias)
    seconds = time.perf_counter() - started
    destination.mkdir()
    model_path = destination / 'model.pt'
    torch.save({'deltaWeight': fit.delta_weight, 'deltaBias': fit.delta_bias, 'vocabularies': fit.vocabularies,
                'timebase': fit.timebase, 'qualityWeight': weight, 'qualityBias': bias}, model_path)
    report = {'profile': profile, 'protocol': PROTOCOL, 'captureManifests': provenance, 'trainingInputs': inputs,
        'trainingWorks': list(dict.fromkeys(i['work'] for i in inputs)), 'targetLabelsRead': False,
        'model': {'path': artifact_reference(model_path), 'sha256': digest(model_path)},
        'runnerSha256': digest(pathlib.Path(__file__)), 'readoutSha256': digest(pathlib.Path(__file__).with_name('rnbert_readout.py')),
        'mapperControls': controls, 'timebase': fit.timebase, 'accounting': fit.accounting, 'lossTrace': fit.loss_trace,
        'seconds': seconds, 'scope': 'Quality-only readout correction. Function, degree, inversion, source observations and strict evaluation are independent.'}
    manifest = destination / 'manifest.json'; manifest.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'manifest': str(manifest), 'sha256': digest(manifest), 'trainingExamples': len(examples), 'seconds': seconds}, indent=2))


def decode_readout(captures_path, model_path, profile, factor_evidence=False):
    import torch
    from rnbert_decode import decode_coherent
    from rnbert_readout import QualityFit, apply_quality_readout, validate_capture
    rows, provenance = readout_captures(captures_path, 'development')
    model_path = pathlib.Path(model_path).resolve(); manifest = json.loads(model_path.read_text())
    model_weights = WORKSPACE / manifest['model']['path']
    if manifest['targetLabelsRead'] is not False or digest(model_weights) != manifest['model']['sha256']:
        raise ValueError('Frozen fit manifest/model changed.')
    if digest(pathlib.Path(__file__).with_name('rnbert_readout.py')) != manifest['readoutSha256']:
        raise ValueError('Readout implementation changed since fitting.')
    model = torch.load(model_weights, map_location='cpu', weights_only=True)
    fit = QualityFit(model['deltaWeight'], model['deltaBias'], model['vocabularies'], model['timebase'], [], [])
    parse, controls = mapper(); results = {'original': [], 'quality': []}; inputs = []
    paths = [ROOT / f'mapping-manifest-{profile}-{mode}.json' for mode in results]
    if any(p.exists() for p in paths) or (ROOT / f'decoding-manifest-{profile}.json').exists():
        raise ValueError('Decode profile exists; choose a new profile to retain frozen outputs.')
    for item in rows:
        work, b = item['work'], item['bundle']; c = quality_capture(b)
        validate_capture(c, b['qualityWeight'], b['qualityBias'])
        if not torch.equal(model['qualityWeight'], b['qualityWeight']) or not torch.equal(model['qualityBias'], b['qualityBias']):
            raise ValueError('Decode capture uses a different pretrained readout.')
        quality = apply_quality_readout(c, fit)
        logits_path = ROOT / f'{work}-{profile}-atomic-logits.pt'
        torch.save({'degree': b['logits']['degree'], 'quality': quality, 'originalQuality': b['logits']['quality'],
                    'inversion': b['logits']['inversion'], 'frames': b['frames'], 'vocabularies': b['vocabularies']}, logits_path)
        for mode in results:
            decoded = decode_coherent(b['frames'], b['logits'], b['vocabularies'], parse=parse, ppq=b['ppq'],
                                      overrides={'quality': quality} if mode == 'quality' else None, include_evidence=factor_evidence)
            output = f'{work}-{profile}-{mode}-predictions.json'
            payload = {**decoded['prediction'], 'work': work, 'ppq': b['ppq'], 'targetLabelsRead': False,
                'sourceScoreSha256': item['source']['derivedScore']['sha256'], 'fitManifestSha256': digest(model_path),
                'captureManifestSha256': item['captureManifestSha256']}
            save(output, payload)
            evidence_path = f'{work}-{profile}-{mode}-decoder.json'
            save(evidence_path, {'work': work, 'ppq': b['ppq'], 'targetLabelsRead': False,
                'sourceScoreSha256': payload['sourceScoreSha256'], 'captureManifestSha256': item['captureManifestSha256'],
                **{k: v for k, v in decoded.items() if k != 'prediction'}})
            results[mode].append({'work': work, 'output': output, 'predictionSha256': digest(ROOT / output),
                'sourceScoreSha256': payload['sourceScoreSha256'], 'windowCount': len(payload['windows']),
                'captureManifestSha256': item['captureManifestSha256'], 'atomicLogits': logits_path.name,
                'atomicLogitsSha256': digest(logits_path), 'decoderEvidence': evidence_path, 'decoderEvidenceSha256': digest(ROOT / evidence_path)})
        inputs.append({k: item[k] for k in ('work', 'shift', 'capturePath', 'captureManifestSha256', 'captureSha256')})
    common = {'fitManifest': {'path': artifact_reference(model_path), 'sha256': digest(model_path)}, 'captureManifest': provenance,
        'inputs': inputs, 'mapperControls': controls, 'targetLabelsRead': False, 'factorEvidence': factor_evidence,
        'runnerSha256': digest(pathlib.Path(__file__)), 'decoderSha256': digest(pathlib.Path(__file__).with_name('rnbert_decode.py')),
        'scope': 'Fixed coherent-medium original versus quality-only correction. Function evidence belongs to original predictions; no evidence is transferred onto corrected surfaces.'}
    for mode in results:
        save(f'mapping-manifest-{profile}-{mode}.json', {**common, 'profile': f'{profile}-{mode}', 'results': results[mode]})
    save(f'decoding-manifest-{profile}.json', {**common, 'profile': profile, 'profiles': {
        mode: {'path': p.name, 'sha256': digest(p)} for mode, p in zip(results, paths)}})
    print(json.dumps({'manifest': str(ROOT / f'decoding-manifest-{profile}.json'), 'profiles': list(results)}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['setup', 'check', 'predict', 'capture', 'fit-quality', 'decode', 'map', 'self-test'])
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cuda', help='Recorded by setup; no automatic device fallback.')
    parser.add_argument('--profile', default='baseline', help='Separate output profile; baseline preserves upstream threshold 0.3.')
    parser.add_argument('--onset-threshold', type=float, help='Explicit prediction-time calibration; requires a nonbaseline profile if changed.')
    parser.add_argument('--admission', help='Required for capture; optional original-admission override for a single fit-quality capture batch.')
    parser.add_argument('--shifts', nargs='+', type=int, default=[0], help='Capture semitone shifts, e.g. 0 1 2 ... 11. No labels are opened.')
    parser.add_argument('--captures', nargs='+', help='Independently admitted capture manifests for fit-quality; exactly one for decode.')
    parser.add_argument('--model', help='Frozen fitted quality-readout manifest for decode.')
    parser.add_argument('--factor-evidence', action='store_true', help='Retain large per-frame candidate-state diagnostics from decode; predictions and compact accounting are always saved.')
    parser.add_argument('--works', nargs='+', help='Explicit admitted training subset for fit-quality; default is all admitted works.')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]*', args.profile): parser.error('Invalid profile name.')
    if args.onset_threshold is not None and (args.command != 'predict' or not 0 <= args.onset_threshold <= 1):
        parser.error('--onset-threshold is a probability for predict only.')
    if args.command == 'capture' and (not args.admission or args.profile == 'baseline'):
        parser.error('capture requires --admission and a distinct --profile.')
    if args.command not in ('capture', 'fit-quality') and args.admission:
        parser.error('--admission is for capture or fit-quality.')
    if args.command != 'capture' and args.shifts != [0]: parser.error('--shifts is capture-only.')
    if args.command == 'fit-quality' and (not args.captures or args.profile == 'baseline'):
        parser.error('fit-quality requires --captures and a distinct --profile; each batch retains its original admission.')
    if args.command == 'decode' and (not args.captures or not args.model or args.profile == 'baseline'):
        parser.error('decode requires --captures, --model, and a distinct --profile.')
    if args.command == 'decode' and len(args.captures) != 1:
        parser.error('decode accepts exactly one capture manifest.')
    if args.works and args.command != 'fit-quality': parser.error('--works is fit-quality-only.')
    if args.model and args.command != 'decode': parser.error('--model is decode-only.')
    if args.factor_evidence and args.command != 'decode': parser.error('--factor-evidence is decode-only.')
    if args.captures and args.command not in ('fit-quality', 'decode'): parser.error('--captures is for fit-quality or decode.')
    if args.command == 'setup': setup(args.device)
    elif args.command == 'check': check_inputs()
    elif args.command == 'predict': predict(args.profile, args.onset_threshold)
    elif args.command == 'capture': print(json.dumps(capture(args.admission, args.profile, args.shifts), indent=2))
    elif args.command == 'fit-quality': fit_quality(args.captures, args.admission, args.profile, args.works)
    elif args.command == 'decode': decode_readout(args.captures[0], args.model, args.profile, args.factor_evidence)
    elif args.command == 'map': map_predictions(args.profile)
    else:
        from test_rnbert import run_tests
        controls = run_tests()
        print(f'{controls} synthetic research tests, {mapper()[1]} independent mapping controls and {check_key_decoder()} exact key-decoder controls passed.')
