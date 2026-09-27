//! System-side message renderers.
//!
//! Ported from `src/components/messages/SystemTextMessage.tsx`,
//! `SystemAPIErrorMessage.tsx`, `RateLimitMessage.tsx`, `ShutdownMessage.tsx`,
//! `SnipBoundaryMessage.tsx` and `HookProgressMessage.tsx`.

use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::render;
use crate::theme::{fig, Ink};

/// Dispatch a system-role message. The client tags system text by its content,
/// matching how the TSX picks a renderer from the message type.
pub fn dispatch(text: &str) -> Vec<Line<'static>> {
    if is_shutdown(text) {
        return render_shutdown(text);
    }
    if is_rate_limit(text) {
        return render_rate_limit(text);
    }
    if is_api_error(text) {
        return render_system_api_error(text);
    }
    render_system_text(text)
}

/// Ported from `SystemTextMessage.tsx`: plain system output.
pub fn render_system_text(text: &str) -> Vec<Line<'static>> {
    if text.is_empty() {
        return Vec::new();
    }
    // The TSX colours bullet-prefixed system output as an error notice.
    let (glyph, body, tone) = match text.strip_prefix("● ").or(text.strip_prefix("⏺ ")) {
        Some(rest) => (Some(fig::black_circle()), rest, Ink::Error),
        None => (None, text, Ink::Text),
    };
    let mut out: Vec<Line<'static>> = Vec::new();
    for (i, l) in body.lines().enumerate() {
        let mut spans: Vec<Span<'static>> = Vec::new();
        if i == 0 {
            if let Some(g) = glyph {
                spans.push(render::raw(g));
                spans.push(render::raw(" "));
            }
        }
        spans.push(Span::styled(
            l.to_string(),
            Style::default().fg(tone.color()),
        ));
        out.push(render::line(spans));
    }
    out
}

/// Ported from `SystemAPIErrorMessage.tsx`.
pub fn render_system_api_error(text: &str) -> Vec<Line<'static>> {
    vec![render::line(vec![render::colored(
        text.to_string(),
        Ink::Error,
    )])]
}

/// Ported from `RateLimitMessage.tsx`: the limit text in the error colour, or
/// dimmed when it is only informational.
pub fn render_rate_limit(text: &str) -> Vec<Line<'static>> {
    if text.is_empty() {
        return Vec::new();
    }
    if is_rate_limit_error(text) {
        return vec![render::line(vec![render::colored(text.to_string(), Ink::Error)])];
    }
    vec![render::line(vec![render::dim(text.to_string())])]
}

/// Ported from `ShutdownMessage.tsx`: a teammate asked to stop, or the answer.
/// The request is a warning; the confirmation is subtle.
pub fn render_shutdown(text: &str) -> Vec<Line<'static>> {
    let (tone, body) = if text.starts_with("[Shutdown Request") {
        (Ink::Warning, text)
    } else {
        (Ink::Subtle, text)
    };
    let style = Style::default().fg(tone.color()).add_modifier(Modifier::BOLD);
    let mut out = vec![render::line(vec![Span::styled(body.to_string(), style)])];
    if let Some(reason) = text.split_once(": ").map(|(_, r)| r) {
        out.push(render::line(vec![render::text(reason.to_string())]));
    }
    out
}

/// Ported from `SnipBoundaryMessage.tsx`: the marker where a transcript snip
/// was taken.
pub fn render_snippet_boundary() -> Vec<Line<'static>> {
    vec![render::line(vec![render::dim("··· transcript snip")])]
}

/// Ported from `HookProgressMessage.tsx`: a hook running, with its spinner
pub fn render_hook_progress(text: &str) -> Vec<Line<'static>> {
    vec![render::line(vec![
        render::colored(fig::TEARDROP_ASTERISK, Ink::Claude),
        render::raw(" "),
        render::dim(text.to_string()),
    ])]
}


fn is_shutdown(text: &str) -> bool {
    text.starts_with("[Shutdown")
}

fn is_rate_limit(text: &str) -> bool {
    text.contains("rate limit") || text.contains("usage limit")
}

fn is_rate_limit_error(text: &str) -> bool {
    text.contains("rate limit exceeded") || text.contains("usage limit reached")
}

fn is_api_error(text: &str) -> bool {
    text.starts_with("API Error")
}
