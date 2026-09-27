//! Rendering primitives shared by every message and tool renderer.
//!
//! The TypeScript side builds Ink element trees (`<Box>`, `<Text color=...>`)
//! and lets the layout engine nest them. Ratatui instead hands us a flat
//! `Vec<Line>`, so each renderer here is a pure function from view data to
//! lines. Nesting is expressed by indentation depth, which is what the REPL's
//! `<Box marginLeft>` does visually.

use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::theme::Ink;

/// One indent level. The REPL nests tool output and thinking under their
/// parent with a two-space margin.
pub const INDENT: &str = "  ";

/// Build a `Line` from spans.
pub fn line(spans: Vec<Span>) -> Line<'static> {
    Line::from(spans)
}

/// A plain text span in the theme's default foreground.
pub fn text(s: impl Into<String>) -> Span<'static> {
    Span::styled(s.into(), Style::default().fg(Ink::Text.color()))
}

/// A span in an explicit theme colour.
pub fn colored(s: impl Into<String>, ink: Ink) -> Span<'static> {
    Span::styled(s.into(), Style::default().fg(ink.color()))
}

/// A dimmed span, equivalent to Ink's `<Text dimColor>`.
pub fn dim(s: impl Into<String>) -> Span<'static> {
    Span::styled(s.into(), Style::default().fg(Ink::Dim.color()))
}

/// A bold span, used for the role label (`you`, `assistant`, `tool`).
pub fn bold(s: impl Into<String>, ink: Ink) -> Span<'static> {
    Span::styled(
        s.into(),
        Style::default().fg(ink.color()).add_modifier(Modifier::BOLD),
    )
}

/// Prefix every line with `depth` levels of indentation.
pub fn indent(lines: &mut [Line<'static>], depth: usize) {
    for l in lines.iter_mut() {
        if l.spans.is_empty() {
            continue;
        }
        let mut spans: Vec<Span<'static>> = Vec::with_capacity(depth + l.spans.len());
        for _ in 0..depth {
            spans.push(Span::raw(INDENT));
        }
        spans.extend(l.spans.drain(..));
        l.spans = spans;
    }
}

/// Split text into lines, mapping each to a span of the given style. Ink
/// renders `\n` inside a single `<Text>` the same way.
pub fn wrap(text: &str, style: Style) -> Vec<Line<'static>> {
    text.lines()
        .map(|l| Line::from(vec![Span::styled(l.to_string(), style)]))
        .collect()
}

/// A blank line, used to separate blocks.
pub fn blank() -> Line<'static> {
    Line::from("")
}

/// The label line every message type starts with: the glyph, then the role
/// name in bold, matching `Messages.tsx`'s per-type headers.
pub fn header(glyph: &str, glyph_ink: Ink, label: &str, label_ink: Ink) -> Line<'static> {
    line(vec![
        bold(glyph.to_string(), glyph_ink),
        Span::raw(" "),
        bold(label.to_string(), label_ink),
    ])
}
