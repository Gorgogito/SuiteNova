mod mail;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Qué módulo abre cada tipo de archivo (para «Abrir con» y el doble clic en los tipos propios).
fn module_for(path: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "docx" | "txt" | "html" | "htm" => "writer",
        "xlsx" | "csv" | "tsv" => "calc",
        "pptx" | "ppsx" | "potx" | "odp" | "ppt" | "pps" => "slides",
        "sqlite" | "sqlite3" | "db" => "base",
        "novanotes" => "notes",
        "novamail" | "eml" | "mbox" | "ics" | "vcf" | "msg" | "pst" | "ost" => "mail",
        "novaplan" => "plan",
        "novadiagram" | "vsdx" => "diagram",
        "novaforms" => "forms",
        _ => return None,
    })
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Si la aplicación se inició con un archivo (doble clic, «Abrir con» o la línea de órdenes), abre su módulo directamente.
fn open_file_from_args(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let Some(path) = std::env::args().skip(1).find(|a| std::path::Path::new(a).is_file() && module_for(a).is_some()) else {
        return Ok(());
    };
    let module = module_for(&path).unwrap();
    let title = std::path::Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or("SuiteNova").to_string();
    let url = format!("index.html?app={module}&open={}", percent_encode(&path));
    WebviewWindowBuilder::new(app, format!("{module}-inicio"), WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(1280.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .build()?;
    // el Hub no hace falta si se llegó con un archivo
    if let Some(main) = app.get_webview_window("main") {
        main.close()?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| open_file_from_args(app))
        .invoke_handler(tauri::generate_handler![
            mail::commands::mail_accounts,
            mail::commands::mail_account_save,
            mail::commands::mail_account_remove,
            mail::commands::mail_test,
            mail::commands::mail_list_folders,
            mail::commands::mail_oauth_login,
            mail::commands::mail_oauth_forget,
            mail::commands::mail_folder_state,
            mail::commands::mail_fetch,
            mail::commands::mail_move,
            mail::commands::mail_remove,
            mail::commands::mail_append,
            mail::commands::mail_create_folder,
            mail::commands::mail_delete_folder,
            mail::commands::mail_set_flag,
            mail::commands::mail_send,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar SuiteNova");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_extensions_to_modules() {
        assert_eq!(module_for("C:\\x\\Informe.DOCX"), Some("writer"));
        assert_eq!(module_for("/a/b.xlsx"), Some("calc"));
        assert_eq!(module_for("a.novaforms"), Some("forms"));
        assert_eq!(module_for("a.vsdx"), Some("diagram"));
        assert_eq!(module_for("C:\\Correo\\archivo.PST"), Some("mail"));
        assert_eq!(module_for("mensaje.msg"), Some("mail"));
        assert_eq!(module_for("sin_extension"), None);
        assert_eq!(module_for("virus.exe"), None);
    }

    #[test]
    fn encodes_paths_for_a_url() {
        assert_eq!(percent_encode("C:\\Mis datos\\año.docx"), "C%3A%5CMis%20datos%5Ca%C3%B1o.docx");
    }
}
// rebuild 1792605475
// Nova Mail 0.0.7 build
