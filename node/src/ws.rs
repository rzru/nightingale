//! Room socket: one connection per singer, authenticated by the token issued at
//! join time.

use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};

use crate::{
    api::Shared,
    proto::{ClientFrame, ServerFrame},
    rooms::{now_ms, Room, RoomError},
};

#[derive(Debug, Deserialize)]
pub(crate) struct WsQuery {
    room: String,
    token: String,
}

pub(crate) async fn handle_upgrade(
    State(node): State<Shared>,
    Query(query): Query<WsQuery>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Ok((room, member_id)) = node.store.authenticate(&query.room, &query.token).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    upgrade.on_upgrade(move |socket| run(node, room, member_id, socket))
}

async fn run(node: Shared, room: Arc<Room>, member_id: String, socket: WebSocket) {
    if room.attach(&member_id).await.is_err() {
        return;
    }

    let mut events = room.subscribe();
    let (mut sink, mut stream) = socket.split();
    let (direct_tx, mut direct_rx) = mpsc::channel::<ServerFrame>(16);

    // Snapshot first so a fresh client renders without waiting for a mutation.
    if let Ok(text) = serde_json::to_string(&ServerFrame::RoomState {
        state: room.view().await,
    }) {
        if sink.send(Message::Text(text)).await.is_err() {
            return;
        }
    }

    let writer = tokio::spawn(async move {
        loop {
            tokio::select! {
                event = events.recv() => match event {
                    Ok(text) => {
                        if sink.send(Message::Text(text.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                },
                frame = direct_rx.recv() => {
                    let Some(frame) = frame else {
                        break;
                    };
                    let Ok(text) = serde_json::to_string(&frame) else {
                        continue;
                    };
                    if sink.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    let reader_room = Arc::clone(&room);
    let reader_member_id = member_id.clone();
    let reader = tokio::spawn(async move {
        while let Some(message) = stream.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    if !dispatch(&reader_room, &reader_member_id, &text, &direct_tx).await {
                        break;
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });

    let _ = tokio::join!(writer, reader);

    if room.member_count().await == 0 {
        room.close("empty");
        node.store.remove(room.id()).await;
    } else {
        room.detach(&member_id).await;
    }
}

async fn dispatch(
    room: &Room,
    member_id: &str,
    raw: &str,
    direct: &mpsc::Sender<ServerFrame>,
) -> bool {
    let Ok(frame) = serde_json::from_str::<ClientFrame>(raw) else {
        tracing::trace!("dropping malformed room frame");

        return true;
    };

    match frame {
        ClientFrame::Ready { ready } => deny_on_error(room, room.set_ready(member_id, ready).await),
        ClientFrame::HasTrack { has_track } => {
            deny_on_error(room, room.set_has_track(member_id, has_track).await)
        }
        ClientFrame::Track { hash, title } => {
            deny_on_error(room, room.set_track(member_id, &hash, &title).await)
        }
        ClientFrame::Leave => {
            room.release(member_id).await;

            false
        }
        ClientFrame::Color { color } => {
            deny_on_error(room, room.set_color(member_id, &color).await)
        }
        ClientFrame::Loaded => deny_on_error(room, room.set_loaded(member_id).await),
        ClientFrame::Pause => deny_on_error(room, room.pause(member_id).await),
        ClientFrame::Resume => deny_on_error(room, room.resume(member_id).await),
        ClientFrame::SkipIntro { position_ms } => {
            deny_on_error(room, room.seek(member_id, position_ms).await)
        }
        ClientFrame::SkipOutro => finish_song(room, member_id).await,
        ClientFrame::Seek { position_ms } => {
            deny_on_error(room, room.seek(member_id, position_ms).await)
        }
        ClientFrame::Start => deny_on_error(room, room.start(member_id).await),
        ClientFrame::End => deny_on_error(room, room.end(member_id).await),
        ClientFrame::Pitch {
            hz,
            semitone,
            similarity,
            position_ms,
        } => {
            room.broadcast_pitch(member_id, hz, semitone, similarity, position_ms);

            true
        }
        ClientFrame::Score { score } => deny_on_error(room, room.set_score(member_id, score).await),
        ClientFrame::Ping { client_ms } => {
            let _ = direct
                .send(ServerFrame::Pong {
                    client_ms,
                    server_ms: now_ms(),
                })
                .await;

            true
        }
    }
}

/// The host finished the song; the room returns to its lobby.
async fn finish_song(room: &Room, member_id: &str) -> bool {
    match room.skip_outro(member_id).await {
        Ok(position) => {
            room.announce(ServerFrame::Skip {
                kind: "outro".to_owned(),
                position_ms: position,
            });

            true
        }
        Err(error) => {
            room.deny(&error);

            true
        }
    }
}

fn deny_on_error(room: &Room, result: Result<(), RoomError>) -> bool {
    if let Err(error) = result {
        room.deny(&error);
    }

    true
}
