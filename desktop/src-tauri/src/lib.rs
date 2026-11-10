use axum::{
    body::Body,
    extract::{Path as RoutePath, State as RouteState},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::{Read, Write}, path::{Path, PathBuf}, sync::{Arc, Mutex}};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

#[derive(Clone)]
struct BridgeState {
    port: u16,
    secret: String,
    tasks: Arc<Mutex<HashMap<String, BrowserTask>>>,
    active_task_id: Arc<Mutex<Option<String>>>,
    app: AppHandle,
}

#[derive(Clone)]
struct BrowserTask {
    payload: BrowserPayload,
    video: PathBuf,
    portrait: Option<PathBuf>,
    landscape: Option<PathBuf>,
    status: String,
    created_at: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTaskSummary {
    id: String,
    platform: String,
    title: String,
    status: String,
    created_at: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTaskList {
    tasks: Vec<BrowserTaskSummary>,
    active_task_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserPayload {
    id: String,
    platform: String,
    title: String,
    description: String,
    tags: Vec<String>,
    declaration: String,
    video: AssetInfo,
    portrait: Option<AssetInfo>,
    landscape: Option<AssetInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetInfo {
    name: String,
    bytes: u64,
    mime: String,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTaskInput {
    id: String,
    platform: String,
    file_path: String,
    title: String,
    description: String,
    tags: Vec<String>,
    declaration: String,
    thumbnail_portrait: String,
    thumbnail_landscape: String,
    initial_status: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTaskStatus {
    task_id: String,
    status: String,
    message: String,
    evidence: Option<PublicationEvidence>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationEvidence {
    record_id: String,
    record_url: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeInfo {
    extension_path: String,
    port: u16,
    pair_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileDigest {
    sha256: String,
    bytes: u64,
    file_path: String,
}

fn validated_file(path: &str, extensions: &[&str]) -> Result<PathBuf, String> {
    let file = PathBuf::from(path).canonicalize().map_err(|error| format!("找不到文件：{error}"))?;
    if !file.is_file() { return Err("请选择有效文件".into()); }
    let extension = file.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !extensions.contains(&extension.as_str()) { return Err(format!("不支持的文件格式：{extension}")); }
    Ok(file)
}

fn asset(path: &Path, url: String) -> Result<AssetInfo, String> {
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
    let mime = match extension.as_str() {
        "mp4" => "video/mp4", "mov" => "video/quicktime", "webm" => "video/webm",
        "mkv" => "video/x-matroska", "avi" => "video/x-msvideo",
        "jpg" | "jpeg" => "image/jpeg", "png" => "image/png", _ => "application/octet-stream",
    };
    Ok(AssetInfo {
        name: path.file_name().and_then(|value| value.to_str()).unwrap_or("media").to_string(),
        bytes: fs::metadata(path).map_err(|error| error.to_string())?.len(),
        mime: mime.into(), url,
    })
}

#[tauri::command]
fn prepare_video_preview(app: AppHandle, path: String) -> Result<String, String> {
    let file = validated_file(&path, &["mp4", "mov", "mkv", "webm", "avi"])?;
    app.asset_protocol_scope().allow_file(&file).map_err(|error| format!("无法预览视频：{error}"))?;
    Ok(file.display().to_string())
}

#[tauri::command]
async fn hash_video_file(path: String) -> Result<FileDigest, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file_path = validated_file(&path, &["mp4", "mov", "mkv", "webm", "avi"])?;
        let file = fs::File::open(&file_path).map_err(|error| format!("无法读取视频：{error}"))?;
        let before = file.metadata().map_err(|error| error.to_string())?;
        let mut reader = std::io::BufReader::new(file);
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 1024 * 1024];
        let mut bytes = 0u64;
        loop {
            let count = reader.read(&mut buffer).map_err(|error| format!("读取视频失败：{error}"))?;
            if count == 0 { break; }
            hasher.update(&buffer[..count]);
            bytes += count as u64;
        }
        let after = fs::metadata(&file_path).map_err(|error| error.to_string())?;
        if bytes != before.len() || before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err("视频文件在计算哈希时发生变化，请重试".into());
        }
        Ok(FileDigest { sha256: format!("{:x}", hasher.finalize()), bytes, file_path: file_path.display().to_string() })
    }).await.map_err(|error| format!("计算视频哈希失败：{error}"))?
}

#[tauri::command]
fn prepare_cover_preview(app: AppHandle, path: String) -> Result<String, String> {
    let file = validated_file(&path, &["jpg", "jpeg", "png"])?;
    app.asset_protocol_scope().allow_file(&file).map_err(|error| format!("无法预览封面：{error}"))?;
    Ok(file.display().to_string())
}

#[tauri::command]
fn save_cover_frame(app: AppHandle, orientation: String, bytes: Vec<u8>) -> Result<String, String> {
    if !["landscape", "portrait"].contains(&orientation.as_str()) { return Err("封面方向无效".into()); }
    if bytes.len() < 4 || bytes.len() > 4_500_000 || !bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Err("截帧图片无效或超过 4.5 MB".into());
    }
    let folder = app.path().app_data_dir().map_err(|error| error.to_string())?.join("covers");
    fs::create_dir_all(&folder).map_err(|error| format!("无法建立封面目录：{error}"))?;
    let file = folder.join(format!("frame-{orientation}-{}.jpg", Uuid::new_v4()));
    fs::write(&file, bytes).map_err(|error| format!("无法保存封面：{error}"))?;
    app.asset_protocol_scope().allow_file(&file).map_err(|error| format!("无法预览封面：{error}"))?;
    Ok(file.display().to_string())
}

const EXTENSION_FILES: &[(&str, &str)] = &[
    ("manifest.json", include_str!("../../extension/manifest.json")),
    ("background.js", include_str!("../../extension/background.js")),
    ("connect.js", include_str!("../../extension/connect.js")),
    ("douyin.js", include_str!("../../extension/douyin.js")),
    ("baijiahao.js", include_str!("../../extension/baijiahao.js")),
    ("dayu.js", include_str!("../../extension/dayu.js")),
    ("popup.html", include_str!("../../extension/popup.html")),
    ("popup.js", include_str!("../../extension/popup.js")),
];

#[tauri::command]
fn bridge_info(app: AppHandle, state: State<'_, BridgeState>) -> Result<BridgeInfo, String> {
    let folder = app.path().app_data_dir().map_err(|error| error.to_string())?.join("browser-extension");
    fs::create_dir_all(&folder).map_err(|error| format!("无法建立扩展目录：{error}"))?;
    for (name, content) in EXTENSION_FILES {
        let path = folder.join(name);
        if fs::read_to_string(&path).ok().as_deref() != Some(content) {
            fs::write(&path, content).map_err(|error| format!("无法写入浏览器扩展：{error}"))?;
        }
    }
    let extension_path = if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension")
            .canonicalize().unwrap_or(folder).display().to_string()
    } else {
        folder.display().to_string()
    };
    Ok(BridgeInfo {
        extension_path,
        port: state.port,
        pair_url: format!("http://127.0.0.1:{}/connect#token={}", state.port, state.secret),
    })
}

#[tauri::command]
fn create_browser_task(state: State<'_, BridgeState>, input: BrowserTaskInput) -> Result<String, String> {
    if Uuid::parse_str(&input.id).is_err() { return Err("任务编号无效".into()); }
    if !["douyin", "baijiahao", "dayu"].contains(&input.platform.as_str()) { return Err("该平台尚未接入浏览器扩展".into()); }
    if input.title.trim().is_empty() || input.title.chars().count() > 30 { return Err("标题需为 1 到 30 字".into()); }
    if input.description.chars().count() > 2000 { return Err("简介过长，请缩短后重试".into()); }
    if !["", "内容为转载信息", "内容由AI生成", "内容为个人观点或见解"].contains(&input.declaration.as_str()) {
        return Err("抖音声明类型无效".into());
    }
    let video = validated_file(&input.file_path, &["mp4", "mov", "mkv", "webm", "avi"])?;
    let portrait = if input.thumbnail_portrait.is_empty() { None } else { Some(validated_file(&input.thumbnail_portrait, &["jpg", "jpeg", "png"])?) };
    let landscape = if input.thumbnail_landscape.is_empty() { None } else { Some(validated_file(&input.thumbnail_landscape, &["jpg", "jpeg", "png"])?) };
    let base = format!("http://127.0.0.1:{}/api/tasks/{}/media", state.port, input.id);
    let payload = BrowserPayload {
        id: input.id.clone(), platform: input.platform.clone(), title: input.title.trim().into(), description: input.description,
        tags: input.tags.into_iter().map(|value| value.trim().trim_start_matches('#').to_string()).filter(|value| !value.is_empty()).take(20).collect(),
        declaration: input.declaration,
        video: asset(&video, format!("{base}/video"))?,
        portrait: portrait.as_ref().map(|path| asset(path, format!("{base}/portrait"))).transpose()?,
        landscape: landscape.as_ref().map(|path| asset(path, format!("{base}/landscape"))).transpose()?,
    };
    let mut tasks = state.tasks.lock().map_err(|_| "任务状态不可用")?;
    let created_at = tasks.get(&input.id).map(|task| task.created_at).unwrap_or_else(||
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
    let status = tasks.get(&input.id).map(|task| task.status.clone()).or_else(|| input.initial_status.filter(|value|
        ["queued", "opened", "uploading", "filling", "failed", "prepared"].contains(&value.as_str())))
        .unwrap_or_else(|| "queued".into());
    tasks.insert(input.id.clone(), BrowserTask { payload, video, portrait, landscape, status, created_at });
    Ok(format!("http://127.0.0.1:{}/connect#task={}&token={}", state.port, input.id, state.secret))
}

async fn list_tasks(RouteState(state): RouteState<BridgeState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state) { return StatusCode::UNAUTHORIZED.into_response(); }
    let Ok(tasks) = state.tasks.lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response(); };
    let mut result: Vec<_> = tasks.values().map(|task| BrowserTaskSummary {
        id: task.payload.id.clone(), platform: task.payload.platform.clone(), title: task.payload.title.clone(),
        status: task.status.clone(), created_at: task.created_at,
    }).collect();
    result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let active_task_id = state.active_task_id.lock().ok().and_then(|value| value.clone());
    Json(BrowserTaskList { tasks: result, active_task_id }).into_response()
}

#[tauri::command]
fn set_active_browser_task(state: State<'_, BridgeState>, task_id: Option<String>) -> Result<(), String> {
    if let Some(id) = &task_id {
        if !state.tasks.lock().map_err(|_| "任务状态不可用")?.contains_key(id) {
            return Err("找不到可供扩展填写的任务".into());
        }
    }
    *state.active_task_id.lock().map_err(|_| "当前发布项目不可用")? = task_id;
    Ok(())
}

#[tauri::command]
fn cancel_browser_task(state: State<'_, BridgeState>, task_id: String) -> Result<(), String> {
    state.tasks.lock().map_err(|_| "任务状态不可用")?.remove(&task_id);
    let mut active = state.active_task_id.lock().map_err(|_| "当前发布项目不可用")?;
    if active.as_deref() == Some(&task_id) { *active = None; }
    Ok(())
}

fn authorized(headers: &HeaderMap, state: &BridgeState) -> bool {
    headers.get(header::AUTHORIZATION).and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == format!("Bearer {}", state.secret))
}

async fn cors(request: Request<Body>, next: Next) -> Response {
    let mut response = if request.method() == Method::OPTIONS { StatusCode::NO_CONTENT.into_response() } else { next.run(request).await };
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, OPTIONS"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("authorization, content-type"));
    headers.insert(HeaderName::from_static("access-control-allow-private-network"), HeaderValue::from_static("true"));
    response
}

async fn connect_page() -> Html<&'static str> {
    Html("<!doctype html><html lang=zh-CN><meta charset=utf-8><title>连接视频发布台</title><style>body{font:15px system-ui;margin:15vh auto;max-width:560px;color:#253238}h1{font-size:22px}p{line-height:1.7}</style><h1>正在连接视频发布台扩展</h1><p>如未出现连接成功提示，请确认已在当前 Chrome 或 Edge 中加载视频发布台扩展。</p><p>连接后可关闭此页，在对应平台发布页点击扩展图标选择作品。最终发布由你在平台页面确认。</p></html>")
}

async fn get_task(RouteState(state): RouteState<BridgeState>, RoutePath(id): RoutePath<String>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state) { return StatusCode::UNAUTHORIZED.into_response(); }
    let task = state.tasks.lock().ok().and_then(|tasks| tasks.get(&id).cloned());
    match task { Some(task) => Json(task.payload).into_response(), None => StatusCode::NOT_FOUND.into_response() }
}

async fn get_media(RouteState(state): RouteState<BridgeState>, RoutePath((id, kind)): RoutePath<(String, String)>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state) { return StatusCode::UNAUTHORIZED.into_response(); }
    let task = state.tasks.lock().ok().and_then(|tasks| tasks.get(&id).cloned());
    let Some(task) = task else { return StatusCode::NOT_FOUND.into_response(); };
    let path = match kind.as_str() {
        "video" => Some(task.video), "portrait" => task.portrait, "landscape" => task.landscape, _ => None,
    };
    let Some(path) = path else { return StatusCode::NOT_FOUND.into_response(); };
    let Ok(file) = tokio::fs::File::open(&path).await else { return StatusCode::NOT_FOUND.into_response(); };
    let Ok(info) = asset(&path, String::new()) else { return StatusCode::INTERNAL_SERVER_ERROR.into_response(); };
    let mut response = Body::from_stream(ReaderStream::new(file)).into_response();
    if let Ok(value) = HeaderValue::from_str(&info.mime) { response.headers_mut().insert(header::CONTENT_TYPE, value); }
    if let Ok(value) = HeaderValue::from_str(&info.bytes.to_string()) { response.headers_mut().insert(header::CONTENT_LENGTH, value); }
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn set_status(RouteState(state): RouteState<BridgeState>, RoutePath(id): RoutePath<String>, headers: HeaderMap, Json(mut status): Json<BrowserTaskStatus>) -> Response {
    if !authorized(&headers, &state) { return StatusCode::UNAUTHORIZED.into_response(); }
    if status.task_id != id || !["opened", "uploading", "filling", "prepared", "verified", "check-failed", "failed"].contains(&status.status.as_str()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(mut tasks) = state.tasks.lock() else { return StatusCode::INTERNAL_SERVER_ERROR.into_response(); };
    let Some(task) = tasks.get_mut(&id) else { return StatusCode::NOT_FOUND.into_response(); };
    if status.status == "verified" {
        let Some(evidence) = &status.evidence else { return StatusCode::BAD_REQUEST.into_response(); };
        let valid_url = match task.payload.platform.as_str() {
            "douyin" => evidence.record_url.starts_with("https://creator.douyin.com/") || evidence.record_url.starts_with("https://www.douyin.com/"),
            "baijiahao" => evidence.record_url.starts_with("https://baijiahao.baidu.com/"),
            "dayu" => evidence.record_url.starts_with("https://mp.dayu.com/") || evidence.record_url.starts_with("https://mparticle.uc.cn/"),
            _ => false,
        };
        if evidence.title != task.payload.title || evidence.record_id.trim().is_empty() || !valid_url {
            return StatusCode::BAD_REQUEST.into_response();
        }
    }
    if status.status != "check-failed" { task.status = status.status.clone(); }
    drop(tasks);
    status.message = status.message.chars().take(500).collect();
    let _ = state.app.emit("browser-task-status", status);
    StatusCode::NO_CONTENT.into_response()
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let listener = std::net::TcpListener::bind("127.0.0.1:47653")
                .or_else(|_| std::net::TcpListener::bind("127.0.0.1:0"))?;
            listener.set_nonblocking(true)?;
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let secret_file = data_dir.join("browser-bridge-token");
            let secret = fs::read_to_string(&secret_file).ok()
                .filter(|value| value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit()))
                .map(Ok).unwrap_or_else(|| {
                    let value = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
                    fs::write(&secret_file, &value).map(|_| value)
                })?;
            let state = BridgeState {
                port: listener.local_addr()?.port(),
                secret,
                tasks: Arc::new(Mutex::new(HashMap::new())),
                active_task_id: Arc::new(Mutex::new(None)),
                app: app.handle().clone(),
            };
            let router = Router::new()
                .route("/connect", get(connect_page))
                .route("/api/tasks", get(list_tasks))
                .route("/api/tasks/{id}", get(get_task))
                .route("/api/tasks/{id}/media/{kind}", get(get_media))
                .route("/api/tasks/{id}/status", post(set_status))
                .layer(middleware::from_fn(cors))
                .with_state(state.clone());
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(listener).expect("bridge listener");
                if let Err(error) = axum::serve(listener, router).await { eprintln!("Browser bridge stopped: {error}"); }
            });
            app.manage(state);
            let handle = app.handle().clone();
            let log_file = app.path().app_log_dir().unwrap_or_else(|_| std::env::temp_dir()).join("faults.log");
            std::panic::set_hook(Box::new(move |info| {
                let message = info.to_string();
                if let Some(parent) = log_file.parent() { let _ = fs::create_dir_all(parent); }
                if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&log_file) {
                    let _ = writeln!(file, "{:?} {message}", std::time::SystemTime::now());
                }
                let _ = handle.emit("native-fault", message);
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bridge_info, create_browser_task, set_active_browser_task, cancel_browser_task, prepare_video_preview, hash_video_file, prepare_cover_preview, save_cover_frame])
        .build(tauri::generate_context!())
        .expect("failed to start desktop app");
    app.run(|_, _| {});
}
