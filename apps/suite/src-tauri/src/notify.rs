//! Avisos del sistema (la notificación que aparece junto al reloj). Por ahora solo en Windows.
//!
//! La página pide el aviso con un identificador suyo; al pulsarlo, o uno de sus botones, la ventana que lo pidió recibe el
//! suceso `nova-notification` con ese identificador y la acción (`open` si se pulsó el aviso). Solo mientras el programa
//! está abierto.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Con este nombre conoce Windows al programa (el mismo identificador de `tauri.conf.json`).
const APP_ID: &str = "org.suitenova.app";
const APP_NAME: &str = "SuiteNova";
/// Los avisos mostrados se conservan un tiempo: sin ellos Windows no puede decir que se pulsaron.
const KEPT: usize = 40;

#[derive(Deserialize, Debug, Clone)]
pub struct Action {
    pub id: String,
    pub label: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct Pressed {
    pub id: String,
    pub action: String,
}

/// Una sola línea sin caracteres de control, de un largo razonable.
fn line(s: &str, max: usize) -> String {
    s.chars().map(|c| if c.is_whitespace() { ' ' } else { c }).filter(|c| !c.is_control() && !matches!(c, '\u{fffe}' | '\u{ffff}')).take(max).collect()
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn check(actions: &[Action]) -> Result<(), String> {
    if actions.len() > 3 {
        return Err("Un aviso admite tres botones como mucho.".into());
    }
    if actions.iter().any(|a| a.id.is_empty() || a.id.len() > 20 || !a.id.chars().all(|c| c.is_ascii_alphanumeric()) || a.id == "open") {
        return Err("El botón del aviso no es válido.".into());
    }
    Ok(())
}

/// La descripción del aviso en el formato de Windows.
fn toast_xml(title: &str, body: &str, actions: &[Action]) -> String {
    let buttons: String = actions.iter().map(|a| format!("<action content=\"{}\" arguments=\"{}\" activationType=\"foreground\"/>", escape(&line(&a.label, 60)), a.id)).collect();
    let buttons = if buttons.is_empty() { buttons } else { format!("<actions>{buttons}</actions>") };
    format!(
        "<toast launch=\"open\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual>{buttons}</toast>",
        escape(&line(title, 120)),
        escape(&line(body, 240))
    )
}

#[cfg(windows)]
mod os {
    use windows::core::{IInspectable, Interface, Ref, HSTRING};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::{ToastActivatedEventArgs, ToastNotification, ToastNotificationManager};

    pub type Shown = ToastNotification;

    /// Windows solo muestra avisos de un programa que conoce: sin instalador, basta anotar su nombre para este usuario.
    pub fn register(app_id: &str, name: &str) -> Result<(), String> {
        let key = windows_registry::CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{app_id}")).map_err(|e| format!("No se pudo registrar el programa para los avisos: {e}"))?;
        key.set_string("DisplayName", name).map_err(|e| format!("No se pudo registrar el programa para los avisos: {e}"))
    }

    pub fn show(app_id: &str, xml: &str, tag: &str, pressed: impl Fn(String) + Send + 'static) -> Result<Shown, String> {
        let make = || -> windows::core::Result<Shown> {
            let doc = XmlDocument::new()?;
            doc.LoadXml(&HSTRING::from(xml))?;
            let toast = ToastNotification::CreateToastNotification(&doc)?;
            // otro aviso de lo mismo sustituye a este
            toast.SetTag(&HSTRING::from(tag))?;
            toast.Activated(&TypedEventHandler::new(move |_, args: Ref<IInspectable>| {
                let action = args.as_ref().and_then(|a| a.cast::<ToastActivatedEventArgs>().ok()).and_then(|a| a.Arguments().ok()).map(|s| s.to_string()).unwrap_or_default();
                pressed(action);
                Ok(())
            }))?;
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)?;
            Ok(toast)
        };
        make().map_err(|e| format!("Windows no mostró el aviso: {e}"))
    }
}

#[cfg(not(windows))]
mod os {
    pub type Shown = ();
    pub fn register(_app_id: &str, _name: &str) -> Result<(), String> {
        Err("Los avisos del sistema solo están disponibles en Windows.".into())
    }
    pub fn show(_app_id: &str, _xml: &str, _tag: &str, _pressed: impl Fn(String) + Send + 'static) -> Result<Shown, String> {
        Err("Los avisos del sistema solo están disponibles en Windows.".into())
    }
}

#[derive(Default)]
pub struct Notices(Mutex<VecDeque<os::Shown>>);

fn tag_of(id: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    id.hash(&mut h);
    format!("{:016x}", h.finish())
}

#[tauri::command]
pub fn notify_show(window: tauri::Window, notices: tauri::State<'_, Notices>, id: String, title: String, body: String, actions: Vec<Action>) -> Result<(), String> {
    if id.is_empty() || id.len() > 300 {
        return Err("El identificador del aviso no es válido.".into());
    }
    check(&actions)?;
    os::register(APP_ID, APP_NAME)?;
    let known: Vec<String> = actions.iter().map(|a| a.id.clone()).collect();
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let of = id.clone();
    let shown = os::show(APP_ID, &toast_xml(&title, &body, &actions), &tag_of(&id), move |action| {
        let action = if known.contains(&action) { action } else { "open".to_string() };
        if action == "open" {
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        let _ = app.emit_to(label.as_str(), "nova-notification", Pressed { id: of.clone(), action });
    })?;
    let mut kept = notices.0.lock().map_err(|_| "Los avisos no están disponibles.".to_string())?;
    kept.push_back(shown);
    while kept.len() > KEPT {
        kept.pop_front();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_text_so_that_it_cannot_break_the_xml() {
        let xml = toast_xml("De <Ana> & \"Luis\"", "línea\r\nsegunda\u{7}", &[Action { id: "snooze".into(), label: "Posponer <5>".into() }]);
        assert!(xml.contains("De &lt;Ana&gt; &amp; &quot;Luis&quot;"));
        assert!(xml.contains("<text>línea  segunda</text>"));
        assert!(xml.contains("content=\"Posponer &lt;5&gt;\" arguments=\"snooze\""));
        assert!(!toast_xml("a", "b", &[]).contains("<actions>"));
        assert!(toast_xml(&"x".repeat(500), "", &[]).len() < 400);
    }

    #[test]
    fn refuses_buttons_that_are_not_names() {
        let a = |id: &str| Action { id: id.into(), label: "x".into() };
        assert!(check(&[a("snooze"), a("dismiss")]).is_ok());
        assert!(check(&[a("a\"/><x")]).is_err());
        assert!(check(&[a("open")]).is_err());
        assert!(check(&[a("a"), a("b"), a("c"), a("d")]).is_err());
        assert_eq!(tag_of("mail:1"), tag_of("mail:1"));
        assert_ne!(tag_of("mail:1"), tag_of("mail:2"));
    }

    /// Muestra de verdad un aviso en este equipo (con un nombre de prueba), comprueba que Windows lo aceptó y borra todo.
    /// Se ejecuta a propósito: `cargo test -- --ignored shows_a_real_notification`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn shows_a_real_notification() {
        use windows::core::HSTRING;
        use windows::UI::Notifications::ToastNotificationManager;
        let id = "org.suitenova.prueba";
        os::register(id, "SuiteNova (prueba)").unwrap();
        let result = (|| -> Result<u32, String> {
            let xml = toast_xml("Prueba de SuiteNova", "Este aviso se borra solo.", &[Action { id: "dismiss".into(), label: "Descartar".into() }]);
            os::show(id, &xml, &tag_of("prueba"), |_| {})?;
            std::thread::sleep(std::time::Duration::from_secs(2));
            let history = ToastNotificationManager::History().map_err(|e| e.to_string())?;
            let shown = history.GetHistoryWithId(&HSTRING::from(id)).and_then(|v| v.Size()).map_err(|e| e.to_string())?;
            history.ClearWithId(&HSTRING::from(id)).map_err(|e| e.to_string())?;
            Ok(shown)
        })();
        windows_registry::CURRENT_USER.remove_tree(format!(r"Software\Classes\AppUserModelId\{id}")).unwrap();
        assert_eq!(result.unwrap(), 1, "Windows no guardó el aviso");
    }
}
