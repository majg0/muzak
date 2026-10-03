use muzak_core::api::{CoreReply, CoreRequest, CoreResponse};
use std::io::{self, BufRead, Write};
use ts_rs::TS;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<_> = std::env::args().collect();
    if arguments
        .iter()
        .any(|argument| argument == "--ontology-glossary")
    {
        println!(
            "{}",
            serde_json::to_string_pretty(&muzak_core::ontology::vocabulary::glossary())?
        );
        return Ok(());
    }
    if let Some(index) = arguments.iter().position(|argument| argument == "--schema") {
        let config = ts_rs::Config::from_env()
            .with_large_int("number")
            .with_out_dir(
                arguments
                    .get(index + 1)
                    .map_or("src/core/generated", String::as_str),
            );
        CoreRequest::export_all(&config)?;
        muzak_core::generator::GeneratorOptions::export_all(&config)?;
        muzak_core::ontology::MusicOntology::export_all(&config)?;
        muzak_core::ontology::vocabulary::GlossaryEntry::export_all(&config)?;
        CoreResponse::export_all(&config)?;
        CoreReply::export_all(&config)?;
        return Ok(());
    }
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        writeln!(stdout, "{}", muzak_core::api::execute_json(&line))?;
        stdout.flush()?;
    }
    Ok(())
}
