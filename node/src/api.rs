//! HTTP surface: everything a client needs before it opens a room socket.

use std::{net::SocketAddr, sync::Arc, time::Instant};

use axum::{
    extract::{ConnectInfo, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    proto::{Count, NodeInfo, RoomSummary, PROTOCOL},
    rooms::{Issued, RoomError, RoomStore},
    ws,
};

pub(crate) struct Node {
    pub(crate) name: String,
    pub(crate) public: bool,
    pub(crate) started: Instant,
    pub(crate) store: RoomStore,
}

pub(crate) type Shared = Arc<Node>;

pub(crate) fn router(node: Shared) -> Router {
    Router::new()
        .route("/api/node", get(node_info))
        .route("/api/rooms", get(list_rooms).post(create_room))
        .route("/api/rooms/:id/join", post(join_room))
        .route("/health", get(health))
        .route("/ws", any(ws::handle_upgrade))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(node)
}

async fn health() -> &'static str {
    "ok"
}

async fn node_info(State(node): State<Shared>) -> Json<NodeInfo> {
    let (rooms, slots) = node.store.counts().await;
    let limits = node.store.limits();

    Json(NodeInfo {
        name: node.name.clone(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol: PROTOCOL,
        public: node.public,
        rooms: Count {
            used: rooms,
            capacity: limits.max_rooms,
        },
        slots: Count {
            used: slots,
            capacity: limits.max_slots,
        },
        uptime_s: node.started.elapsed().as_secs(),
    })
}

async fn list_rooms(State(node): State<Shared>) -> Json<Vec<RoomSummary>> {
    Json(node.store.summaries().await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateRoom {
    name: String,
    host_name: String,
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JoinRoom {
    name: String,
    #[serde(default)]
    password: Option<String>,
}

/// The handshake result: the client then opens `/ws?room=&token=` with these.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Joining {
    room_id: String,
    member_id: String,
    token: String,
}

impl From<Issued> for Joining {
    fn from(issued: Issued) -> Self {
        Self {
            room_id: issued.room_id,
            member_id: issued.member_id,
            token: issued.token,
        }
    }
}

async fn create_room(
    State(node): State<Shared>,
    Json(body): Json<CreateRoom>,
) -> Result<Json<Joining>, ApiError> {
    let issued = node
        .store
        .create(&body.host_name, &body.name, body.password.as_deref())
        .await?;

    Ok(Json(Joining::from(issued)))
}

async fn join_room(
    State(node): State<Shared>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Json(body): Json<JoinRoom>,
) -> Result<Json<Joining>, ApiError> {
    let issued = node
        .store
        .join(addr.ip(), &id, &body.name, body.password.as_deref())
        .await?;

    Ok(Json(Joining::from(issued)))
}

pub(crate) struct ApiError(pub(crate) RoomError);

impl From<RoomError> for ApiError {
    fn from(error: RoomError) -> Self {
        Self(error)
    }
}

#[derive(Serialize)]
pub(crate) struct ErrorBody {
    pub(crate) reason: &'static str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            RoomError::NotFound => StatusCode::NOT_FOUND,
            RoomError::Full | RoomError::AtCapacity => StatusCode::CONFLICT,
            RoomError::BadPassword | RoomError::Denied => StatusCode::UNAUTHORIZED,
            RoomError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            RoomError::ColorTaken => StatusCode::CONFLICT,
            RoomError::InPlayback
            | RoomError::NotHost
            | RoomError::NotPauser
            | RoomError::NoTrack
            | RoomError::TrackUnset
            | RoomError::NotReady
            | RoomError::Invalid => StatusCode::BAD_REQUEST,
            RoomError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status,
            Json(ErrorBody {
                reason: self.0.reason(),
            }),
        )
            .into_response()
    }
}
