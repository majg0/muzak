//! Native research bridge; source admission and inference live in muzak_core.
//! One loaded cache per process. No score/label loader or model fitting here.
use muzak_core::segmental::{self, Cache};
use serde::Deserialize;
use serde_json::json;
use std::io::{self, BufRead, Write};

const MAX_LINE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum Command {
    Load {
        cache: Cache,
    },
    Solve {
        parameters: [f64; 4],
        #[serde(default)]
        posteriors: bool,
        #[serde(default)]
        marginals: bool,
        #[serde(default = "default_marginal_slots", rename = "maxMarginalSlots")]
        max_marginal_slots: usize,
    },
}

fn default_marginal_slots() -> usize {
    4_000_000
}

fn process(value: serde_json::Value, cache: &mut Option<segmental::Admitted>) -> serde_json::Value {
    if value.get("op") == Some(&json!("load")) {
        *cache = None;
    }
    match serde_json::from_value::<Command>(value) {
        Err(e) => json!({"ok":false,"error":{"code":"invalid-json","message":e.to_string()}}),
        Ok(Command::Load { cache: input }) => match segmental::admit(input) {
            Ok(admitted) => {
                let result =
                    json!({"ok":true,"result":{"loaded":true,"statistics":admitted.statistics}});
                *cache = Some(admitted);
                result
            }
            Err(error) => json!({"ok":false,"error":error}),
        },
        Ok(Command::Solve {
            parameters,
            posteriors,
            marginals,
            max_marginal_slots,
        }) => match cache.as_ref() {
            None => {
                json!({"ok":false,"error":{"code":"invalid-input","message":"Load an admitted cache first."}})
            }
            Some(source) => match if marginals {
                source.solve_with_marginals(parameters, max_marginal_slots)
            } else {
                source.solve(parameters, posteriors)
            } {
                Ok(result) => json!({"ok":true,"result":result}),
                Err(error) => json!({"ok":false,"error":error}),
            },
        },
    }
}

// Keep a persistent process while discarding, not allocating, an oversized
// request. Each subsequent line starts a fresh independent computation.
fn line(reader: &mut impl BufRead) -> io::Result<Option<Result<Vec<u8>, ()>>> {
    let mut bytes = Vec::new();
    let mut oversized = false;
    let mut read_any = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(if !read_any {
                None
            } else if oversized {
                Some(Err(()))
            } else {
                Some(Ok(bytes))
            });
        }
        read_any = true;
        let end = available.iter().position(|&b| b == b'\n').map(|i| i + 1);
        let count = end.unwrap_or(available.len());
        oversized |= bytes.len().saturating_add(count) > MAX_LINE_BYTES;
        if !oversized {
            bytes.extend_from_slice(&available[..count]);
        }
        reader.consume(count);
        if end.is_some() {
            return Ok(Some(if oversized { Err(()) } else { Ok(bytes) }));
        }
    }
}

fn main() -> io::Result<()> {
    let mut input = io::BufReader::new(io::stdin().lock());
    let mut output = io::BufWriter::new(io::stdout().lock());
    let mut cache = None;
    while let Some(data) = line(&mut input)? {
        let value = match data {
            Err(()) => {
                json!({"ok":false,"error":{"code":"budget-exceeded","message":"JSON request exceeds128MiB; discarded without graph processing."}})
            }
            Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Err(e) => {
                    json!({"ok":false,"error":{"code":"invalid-json","message":e.to_string()}})
                }
                Ok(value) => process(value, &mut cache),
            },
        };
        serde_json::to_writer(&mut output, &value)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}
