//! Execute-family calls: `BashTool`, `PowerShellTool`.
//!
//! Ported from `packages/builtin-tools/src/tools/BashTool/UI.tsx`. The tool
//! label carries the command (the frame above renders it), so this renders
//! only the output and the terminal's exit status.

use ratatui::style::Style;
use ratatui::text::Line;

use crate::render;
use crate::state::ToolCall;
use crate::theme::Ink;

/// Render a shell call.
pub fn render(call: &ToolCall) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = Vec::new();
    if !call.output.is_empty() {
        let mut body = render::wrap(
            &call.output,
            Style::default().fg(Ink::Subtle.color()),
        );
        render::indent(&mut body, 1);
        out.extend(body);
    }
    if let Some(code) = call.exit_code {
        let span = if code == 0 {
            render::colored("(exit 0)", Ink::Success)
        } else {
            render::colored(format!("(exit {code})"), Ink::Error)
        };
        out.push(render::line(vec![render::raw(render::INDENT), span]));
    }
    out
}
