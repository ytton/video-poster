use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

#[derive(Default)]
struct TaskRegistry {
    pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    ready: bool,
    root: String,
    cli_path: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectedAccount {
    platform: String,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskLine {
    task_id: String,
    stream: &'static str,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskFinished {
    task_id: String,
    exit_code: Option<i32>,
    cancelled: bool,
    message: String,
}

const PLATFORMS: &[&str] = &[
    "facebook-page", "xiaohongshu", "baijiahao", "bilibili", "kuaishou",
    "instagram", "facebook", "tencent", "youtube", "douyin", "alipay",
    "weibo", "hupu", "dayu", "xueqiu", "zhihu",
];

fn default_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn resolve_root(repo_dir: Option<String>) -> Result<PathBuf, String> {
    let candidate = repo_dir.filter(|value| !value.trim().is_empty())
        .map(PathBuf::from).unwrap_or_else(default_root);
    let root = candidate.canonicalize().map_err(|_| format!("找不到项目目录：{}", candidate.display()))?;
    if !root.join("pyproject.toml").is_file() || !root.join("sau_cli.py").is_file() {
        return Err(format!("这不是 social-auto-upload 项目目录：{}", root.display()));
    }
    Ok(root)
}

fn cli_path(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join(".venv/Scripts/sau.exe")
    } else {
        root.join(".venv/bin/sau")
    }
}

fn python_path(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join(".venv/Scripts/python.exe")
    } else {
        root.join(".venv/bin/python")
    }
}

fn installed_root(repo_dir: Option<String>) -> Result<PathBuf, String> {
    let root = resolve_root(repo_dir)?;
    if !cli_path(&root).is_file() || !python_path(&root).is_file() {
        return Err(format!("项目尚未安装 CLI 虚拟环境：{}", root.display()));
    }
    Ok(root)
}

#[tauri::command]
fn runtime_info(repo_dir: Option<String>) -> RuntimeInfo {
    let fallback = repo_dir.clone().filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_root().display().to_string());
    match installed_root(repo_dir) {
        Ok(root) => RuntimeInfo {
            ready: true,
            root: root.display().to_string(),
            cli_path: cli_path(&root).display().to_string(),
            message: "CLI 已就绪".into(),
        },
        Err(message) => RuntimeInfo {
            ready: false,
            root: fallback,
            cli_path: String::new(),
            message,
        },
    }
}

#[tauri::command]
fn list_accounts(repo_dir: Option<String>) -> Result<Vec<DetectedAccount>, String> {
    let root = installed_root(repo_dir)?;
    let folder = root.join("cookies");
    if !folder.is_dir() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some(stem) = file_name.strip_suffix(".json") {
            if let Some((platform, name)) = PLATFORMS.iter().find_map(|platform| {
                stem.strip_prefix(&format!("{platform}_"))
                    .filter(|name| !name.is_empty())
                    .map(|name| ((*platform).to_string(), name.to_string()))
            }) {
                result.push(DetectedAccount { platform, name });
            }
        }
    }
    result.sort_by(|a, b| a.platform.cmp(&b.platform).then(a.name.cmp(&b.name)));
    Ok(result)
}

#[tauri::command]
fn remove_session(repo_dir: Option<String>, platform: String, account: String) -> Result<(), String> {
    if !PLATFORMS.contains(&platform.as_str()) || account.is_empty()
        || account.contains(['/', '\\']) || account.contains("..") {
        return Err("账号名称无效".into());
    }
    let root = installed_root(repo_dir)?;
    let file = root.join("cookies").join(format!("{platform}_{account}.json"));
    if file.is_file() { fs::remove_file(file).map_err(|error| error.to_string())?; }
    Ok(())
}

#[tauri::command]
async fn cli_schema(repo_dir: Option<String>) -> Result<serde_json::Value, String> {
    let root = installed_root(repo_dir)?;
    let output = tokio::process::Command::new(python_path(&root))
        .arg("-c").arg(include_str!("../../bridge.py"))
        .current_dir(&root)
        .env("PYTHONIOENCODING", "utf-8")
        .output().await.map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| format!("读取 CLI 参数失败：{error}"))
}

async fn forward_lines<R: AsyncRead + Unpin>(app: AppHandle, task_id: String, stream: &'static str, reader: R) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(text)) = lines.next_line().await {
        let _ = app.emit("cli-line", TaskLine { task_id: task_id.clone(), stream, text });
    }
}

#[tauri::command]
async fn start_cli(app: AppHandle, state: State<'_, TaskRegistry>, repo_dir: Option<String>, task_id: String, args: Vec<String>) -> Result<(), String> {
    if task_id.trim().is_empty() || args.is_empty() {
        return Err("缺少任务编号或 CLI 参数".into());
    }
    let root = installed_root(repo_dir)?;
    if state.pids.lock().map_err(|_| "任务状态不可用")?.contains_key(&task_id) {
        return Err("任务编号重复".into());
    }
    let mut command = tokio::process::Command::new(cli_path(&root));
    command.args(&args).current_dir(&root).env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1").stdin(Stdio::null())
        .stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().map_err(|error| format!("无法启动 sau：{error}"))?;
    let pid = child.id().ok_or("无法获取 CLI 进程编号")?;
    {
        let mut pids = state.pids.lock().map_err(|_| "任务状态不可用")?;
        pids.insert(task_id.clone(), pid);
    }
    let stdout = child.stdout.take().ok_or("无法读取 CLI 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 CLI 错误输出")?;
    let pids = state.pids.clone();
    let cancelled = state.cancelled.clone();
    tauri::async_runtime::spawn(async move {
        let out = tauri::async_runtime::spawn(forward_lines(app.clone(), task_id.clone(), "stdout", stdout));
        let err = tauri::async_runtime::spawn(forward_lines(app.clone(), task_id.clone(), "stderr", stderr));
        let result = child.wait().await;
        let _ = out.await;
        let _ = err.await;
        if let Ok(mut pids) = pids.lock() { pids.remove(&task_id); }
        let was_cancelled = cancelled.lock().map(|mut set| set.remove(&task_id)).unwrap_or(false);
        let (exit_code, message) = match result {
            Ok(status) => (status.code(), if status.success() { "已完成" } else { "CLI 执行失败" }.to_string()),
            Err(error) => (None, format!("CLI 进程异常退出：{error}")),
        };
        let _ = app.emit("cli-finished", TaskFinished { task_id, exit_code, cancelled: was_cancelled, message });
    });
    Ok(())
}

#[cfg(windows)]
fn kill_tree(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000).output().map_err(|error| error.to_string())?;
    if output.status.success() { Ok(()) } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(not(windows))]
fn kill_tree(pid: u32) -> Result<(), String> {
    let status = std::process::Command::new("kill").args(["-TERM", &pid.to_string()])
        .status().map_err(|error| error.to_string())?;
    if status.success() { Ok(()) } else { Err("无法结束任务".into()) }
}

#[tauri::command]
fn cancel_cli(state: State<'_, TaskRegistry>, task_id: String) -> Result<(), String> {
    let pid = state.pids.lock().map_err(|_| "任务状态不可用")?
        .get(&task_id).copied().ok_or("任务已结束")?;
    state.cancelled.lock().map_err(|_| "任务状态不可用")?.insert(task_id.clone());
    kill_tree(pid)
}

#[tauri::command]
fn open_bilibili_login(app: AppHandle, state: State<'_, TaskRegistry>, repo_dir: Option<String>, task_id: String, account: String) -> Result<(), String> {
    if account.trim().is_empty() {
        return Err("请填写账号别名".into());
    }
    let root = installed_root(repo_dir)?;
    let mut command = std::process::Command::new(cli_path(&root));
    command.args(["bilibili", "login", "--account", &account])
        .current_dir(&root).env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0010);
    }
    let mut child = command.spawn().map_err(|error| format!("无法打开登录终端：{error}"))?;
    state.pids.lock().map_err(|_| "任务状态不可用")?.insert(task_id.clone(), child.id());
    let pids = state.pids.clone();
    let cancelled = state.cancelled.clone();
    std::thread::spawn(move || {
        let result = child.wait();
        if let Ok(mut pids) = pids.lock() { pids.remove(&task_id); }
        let was_cancelled = cancelled.lock().map(|mut set| set.remove(&task_id)).unwrap_or(false);
        let (exit_code, message) = match result {
            Ok(status) => (status.code(), if status.success() { "登录流程已完成" } else { "登录流程未完成" }.to_string()),
            Err(error) => (None, format!("登录终端异常退出：{error}")),
        };
        let _ = app.emit("cli-finished", TaskFinished { task_id, exit_code, cancelled: was_cancelled, message });
    });
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(TaskRegistry::default())
        .setup(|app| {
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
        .invoke_handler(tauri::generate_handler![runtime_info, list_accounts, remove_session, cli_schema, start_cli, cancel_cli, open_bilibili_login])
        .build(tauri::generate_context!())
        .expect("failed to start desktop app");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let state = handle.state::<TaskRegistry>();
            if let Ok(pids) = state.pids.lock() {
                for pid in pids.values() { let _ = kill_tree(*pid); }
            };
        }
    });
}
