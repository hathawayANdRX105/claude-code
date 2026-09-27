//! Fetch-family calls: `WebFetchTool`, `WebSearchTool`, `VaultHttpFetchTool`.
//!
//! Ported from `packages/builtin-tools/src/tools/WebFetchTool/UI.tsx`. The
//! source is shown as a link-ish line, then the fetched body. A link is not
//! clickable in this client, so it renders in the theme's link colour.

use ratatui::style::Style;
use ratatui::text::Line;

use crate::render;
use crate::state::ToolCall;
use crate::theme::Ink;

/// How much of a fetched page the preview shows.
const MAX_BODY_LINES: usize = 15;

/// Render a fetch call.
pub fn render(call: &ToolCall) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = Vec::new();
    if let Some(url) = call.locations.first() {
        out.push(render::line(vec![render::colored(url.clone(), Ink::ProfessionalBlue)]));
    }
    if call.output.is_empty() {
        return out;
    }
    let lines: Vec<&str> = call.output.lines().collect();
    let shown = lines.len().min(MAX_BODY_LINES);
    let mut body = render::wrap(
        &lines[..shown].join("\n"),
        Style::default().fg(Ink::Subtle.color()),
    );
    if lines.len() > shown {
        body.push(render::dim(format!("… {} more lines", lines.len() - shown)));
    }
    render::indent(&mut body, 1);
    out.extend(body);
    out
}
