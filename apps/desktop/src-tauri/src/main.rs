// Prevents a console window from appearing on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `cord --mcp` is the stdio bridge for MCP clients: no window, just a relay.
    if std::env::args().any(|a| a == "--mcp") {
        std::process::exit(cord_lib::mcp::bridge::run());
    }
    cord_lib::run();
}
