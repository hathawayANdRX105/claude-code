//! The prompt input, ported from `src/components/PromptInput/PromptInput.tsx`.
//!
//! The REPL draws a bordered box in the theme's `promptBorder` colour with the
//! `❯` prompt character (from `PromptInputModeIndicator.tsx`) at its left, a
//! dim italic placeholder when the buffer is empty, and queued prompts listed
//! under it (`PromptInputQueuedCommands.tsx`).

use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Paragraph, Wrap};

use crate::render;
use crate::state::UiState;
use crate::theme::Ink;

/// The prompt character the REPL shows at the input's left edge.
pub const PROMPT_CHAR: &str = "❯";

/// The placeholder the REPL shows when the input is empty, from
/// `usePromptInputPlaceholder` in `PromptInput.tsx`.
pub const PLACEHOLDER: &str = "Try \"how do I use web search?\"";

/// The input area's lines: the prompt line, then any queued prompts.
pub fn render_input(state: &UiState) -> Vec<Line<'static>> {
    let mut out: Vec<Line<'static>> = Vec::new();
    let prompt_style = Style::default().fg(Ink::PromptBorder.color());

    if state.input.is_empty() {
        out.push(render::line(vec![
            Span::styled(format!("{PROMPT_CHAR} "), prompt_style),
            Span::styled(
                PLACEHOLDER,
                Style::default()
                    .fg(Ink::Dim.color())
                    .add_modifier(Modifier::ITALIC),
            ),
        ]));
    } else {
        out.push(render::line(vec![
            Span::styled(format!("{PROMPT_CHAR} "), prompt_style),
            render::text(state.input.clone()),
        ]));
    }

    // Queued prompts, the `PromptInputQueuedCommands` list.
    for (i, queued) in state.queued.iter().enumerate() {
        out.push(render::line(vec![
            render::raw("  "),
            render::colored(
                format!("{}. {}", i + 1, queued),
                Ink::Permission,
            ),
        ]));
    }
    out
}

/// Draw the input area with the REPL's `promptBorder` box.
pub fn draw(frame: &mut ratatui::Frame, state: &UiState, area: Rect) {
    let widget = Paragraph::new(render_input(state))
        .block(Block::bordered().border_style(
            Style::default().fg(Ink::PromptBorder.color()),
        ))
        .wrap(Wrap { trim: true });
    frame.render_widget(widget, area);
}
