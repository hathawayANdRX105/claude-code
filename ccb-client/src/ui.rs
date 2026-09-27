use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Paragraph, Wrap};
use ratatui::Frame;

use crate::message;
use crate::permission;
use crate::prompt;
use crate::state::UiState;
use crate::theme::Ink;

/// Draw the whole screen: transcript, permission overlay, input, status.
pub fn render(frame: &mut Frame, state: &UiState) {
    let area = frame.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(3),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .split(area);

    draw_transcript(frame, state, chunks[0]);
    prompt::draw(frame, state, chunks[1]);
    draw_status(frame, state, chunks[2]);

    if let Some(p) = &state.permission {
        permission::draw(frame, p, area);
    }
}

fn draw_transcript(frame: &mut Frame, state: &UiState, area: Rect) {
    let mut lines: Vec<Line<'static>> = Vec::new();
    for m in message::render_transcript(state) {
        lines.extend(m);
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            " (no messages yet) ",
            Style::default().fg(Ink::Dim.color()),
        )));
    }

    // Auto-follow: keep the bottom pinned while new output streams in.
    let visible = area.height.saturating_sub(2) as usize;
    let scroll = if lines.len() > visible && state.follow_bottom {
        lines.len() - visible
    } else {
        0
    };

    let title = if state.title.is_empty() {
        " ccb ".to_string()
    } else {
        format!(" {} ", state.title)
    };
    let widget = Paragraph::new(lines)
        .block(Block::default().title(title))
        .wrap(Wrap { trim: true })
        .scroll((scroll as u16, 0));
    frame.render_widget(widget, area);
}

fn draw_status(frame: &mut Frame, state: &UiState, area: Rect) {
    let session = state
        .session_id
        .as_deref()
        .map(|s| s.chars().take(8).collect::<String>())
        .unwrap_or_else(|| "connecting".to_string());

    let mut spans: Vec<Span> = vec![
        // The agent's own state word (running/idle/requires_action) when known.
        Span::styled(
            {
                let state_word = if state.agent_state.is_empty() {
                    if state.busy { "busy" } else { "idle" }
                } else {
                    state.agent_state.as_str()
                };
                format!("{state_word} · session {session} ")
            },
            Style::default().fg(Color::DarkGray),
        ),
    ];
    if let Some((used, size, cost)) = state.usage {
        spans.push(Span::styled(
            format!("· {} / {} tokens ", used, size),
            Style::default().fg(Color::Blue),
        ));
        if let Some(usd) = cost {
            spans.push(Span::styled(
                format!("· ${usd:.4} "),
                Style::default().fg(Color::Blue),
            ));
        }
    }
    if !state.status.is_empty() {
        spans.push(Span::styled(format!("· {} ", state.status), Style::default().fg(Color::Red)));
    }
    spans.push(Span::styled(
        "· enter=send · q=quit",
        Style::default().fg(Color::DarkGray),
    ));
    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}


