"""Isolated official RNBert comparator. See rnbert-sources.json; never reads labels.

Prepare inputs: npx tsx scripts/compare-rnbert.ts --prepare
In an isolated Linux/WSL Python environment: rnbert.py setup, install the emitted
requirements.txt plus its pinned musicbert_hf checkout, then rnbert.py predict
and rnbert.py map. Evaluate: npx tsx scripts/compare-rnbert.ts --evaluate.
"""
import argparse
import ast
import collections
import csv
import datetime
import hashlib
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
random.seed(0)
np.random.seed(0)
torch.manual_seed(0)

def research_forward(model, **inputs):
    output = model(**{key: value.to(RESEARCH_DEVICE) for key, value in inputs.items()})
    values = output.logits
    output.logits = values.detach().cpu() if isinstance(values, torch.Tensor) else type(values)(value.detach().cpu() for value in values)
    return output

'''.replace('RESEARCH_DEVICE', repr(device))
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
    for row in admissions():
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
        save(output, {'windows': windows})
        reports.append({'work': work, 'chordCsvSha256': digest(path), 'output': output, 'predictionSha256': digest(ROOT / output),
                        'windowCount': len(windows), 'unsupported': unsupported})
    manifest = 'mapping-manifest.json' if profile == 'baseline' else f'mapping-manifest-{profile}.json'
    save(manifest, {**SOURCES['translation'], 'profile': profile, 'controls': control_count, 'results': reports,
        'mapperSha256': digest(pathlib.Path(__file__)), 'tonicPitchClassUnit': 'Native millicents modulo 1200000, from the predicted model key only.',
        'method': 'Author atomic translation plus tonicization_to_key(case_matters=False) resolves root with music21 9.3.0 CAUTIONARY minor6/7; explicit predicted quality supplies core intervals independently of local-key seventh defaults. I64 keeps realization root I. Unknown/lossy classes unavailable, denominator retained.',
        'secondaryModeLimit': 'Mode absent from model degree vocabulary; author diatonic-default heuristic supplies it, not new model evidence.'})
    print(json.dumps(reports))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['setup', 'check', 'predict', 'map', 'self-test'])
    parser.add_argument('--device', choices=['cpu', 'cuda'], default='cuda', help='Recorded by setup; no automatic device fallback.')
    parser.add_argument('--profile', default='baseline', help='Separate output profile; baseline preserves upstream threshold 0.3.')
    parser.add_argument('--onset-threshold', type=float, help='Explicit prediction-time calibration; requires a nonbaseline profile if changed.')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]*', args.profile): parser.error('Invalid profile name.')
    if args.onset_threshold is not None and (args.command != 'predict' or not 0 <= args.onset_threshold <= 1):
        parser.error('--onset-threshold is a probability for predict only.')
    if args.command == 'setup': setup(args.device)
    elif args.command == 'check': check_inputs()
    elif args.command == 'predict': predict(args.profile, args.onset_threshold)
    elif args.command == 'map': map_predictions(args.profile)
    else: print(f'{mapper()[1]} independent mapping controls passed.')
