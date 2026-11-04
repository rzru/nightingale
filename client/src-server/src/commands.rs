use app_api::CommandError;
use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::Value;

use crate::remote::REMOTE_COMMANDS;
use crate::state::AppState;

pub(crate) struct ApiError(CommandError);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.0.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (status, self.0.to_string()).into_response()
    }
}

pub(crate) async fn handle_cmd(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, ApiError> {
    let payload = body.map(|Json(value)| value).unwrap_or(Value::Null);
    app_api::dispatch(state.commands.clone(), &name, payload)
        .await
        .map(Json)
        .map_err(ApiError)
}

/// Same dispatch as [`handle_cmd`], restricted to [`REMOTE_COMMANDS`].
/// Rejecting unknown names here (rather than only hiding them in the phone UI)
/// keeps the LAN surface honest when someone pokes the endpoint by hand.
pub(crate) async fn handle_remote_cmd(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
    body: Option<Json<Value>>,
) -> Response {
    if !REMOTE_COMMANDS.contains(&name.as_str()) {
        return (
            StatusCode::FORBIDDEN,
            "command is not available to remote clients",
        )
            .into_response();
    }

    let payload = body.map(|Json(value)| value).unwrap_or(Value::Null);
    match app_api::dispatch(state.commands.clone(), &name, payload).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => ApiError(error).into_response(),
    }
}
