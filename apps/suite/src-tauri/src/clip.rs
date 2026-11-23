//! Recorte de pantalla nativo. El WebView solo puede capturar lo que el sistema le deja elegir en su selector (y la propia ventana de SuiteNova sale en la
//! captura); aquí se oculta la aplicación, se captura el monitor y se vuelve a mostrar, como hace Office. Dos comandos:
//! - `clip_monitors`: los monitores (posición y tamaño en píxeles físicos, escala, si es el principal).
//! - `clip_capture`: el PNG de un monitor (por defecto, el de la ventana que lo pide), con la aplicación oculta si se pide.
//! El PNG se entrega como bytes sin pasar por JSON (una captura de 4K son varios MB).
//! Solo en Windows por ahora: en los demás sistemas los comandos devuelven un error y la web usa el selector del navegador.

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, WebviewWindow};

#[derive(Clone, Debug, Serialize)]
pub struct ClipMonitor {
    pub index: usize,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f32,
    pub primary: bool,
    pub name: String,
}

#[cfg(windows)]
mod native {
    use super::ClipMonitor;
    use std::io::Cursor;
    use std::time::Duration;
    use tauri::{AppHandle, Manager, WebviewWindow};
    use xcap::Monitor;

    fn describe(index: usize, m: &Monitor) -> Result<ClipMonitor, String> {
        Ok(ClipMonitor {
            index,
            x: m.x().map_err(|e| e.to_string())?,
            y: m.y().map_err(|e| e.to_string())?,
            width: m.width().map_err(|e| e.to_string())?,
            height: m.height().map_err(|e| e.to_string())?,
            scale: m.scale_factor().map_err(|e| e.to_string())?,
            primary: m.is_primary().map_err(|e| e.to_string())?,
            name: m.name().unwrap_or_default(),
        })
    }

    fn monitors() -> Result<Vec<Monitor>, String> {
        let all = Monitor::all().map_err(|e| format!("No se pudo leer la lista de pantallas: {e}"))?;
        if all.is_empty() {
            return Err("No hay ninguna pantalla que capturar.".into());
        }
        Ok(all)
    }

    /// Los monitores del sistema.
    pub fn list_monitors() -> Result<Vec<ClipMonitor>, String> {
        monitors()?.iter().enumerate().map(|(i, m)| describe(i, m)).collect()
    }

    /// El PNG del monitor `index` (el principal si es `None`) y sus datos.
    pub fn capture_monitor_png(index: Option<usize>) -> Result<(Vec<u8>, ClipMonitor), String> {
        let all = monitors()?;
        let i = match index {
            Some(i) if i < all.len() => i,
            Some(_) => return Err("Esa pantalla ya no está conectada.".into()),
            None => all.iter().position(|m| m.is_primary().unwrap_or(false)).unwrap_or(0),
        };
        let info = describe(i, &all[i])?;
        let img = all[i].capture_image().map_err(|e| format!("No se pudo capturar la pantalla: {e}"))?;
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png).map_err(|e| format!("No se pudo guardar la captura: {e}"))?;
        Ok((out, info))
    }

    /// Oculta las ventanas visibles de la aplicación y las devuelve a su sitio al soltarse, pase lo que pase.
    struct Hidden {
        windows: Vec<WebviewWindow>,
        focus: Option<WebviewWindow>,
    }

    impl Hidden {
        fn hide(app: &AppHandle, focus: &WebviewWindow) -> Hidden {
            let mut windows = Vec::new();
            for w in app.webview_windows().into_values() {
                if w.is_visible().unwrap_or(false) && w.hide().is_ok() {
                    windows.push(w);
                }
            }
            // la ventana tarda un momento en desaparecer del escritorio (el compositor la quita después de ocultarla)
            std::thread::sleep(Duration::from_millis(350));
            Hidden { windows, focus: Some(focus.clone()) }
        }
    }

    impl Drop for Hidden {
        fn drop(&mut self) {
            for w in &self.windows {
                let _ = w.show();
            }
            if let Some(f) = self.focus.take() {
                let _ = f.set_focus();
            }
        }
    }

    /// El monitor en el que está la ventana (por su posición), o el principal.
    fn monitor_of(window: &WebviewWindow) -> Option<usize> {
        let cur = window.current_monitor().ok().flatten()?;
        let p = cur.position();
        list_monitors().ok()?.iter().find(|m| m.x == p.x && m.y == p.y).map(|m| m.index)
    }

    /// El PNG de un monitor (el de la ventana que lo pide si no se dice cuál), con la aplicación oculta si `hide`.
    pub fn capture(app: &AppHandle, window: &WebviewWindow, monitor: Option<usize>, hide: bool) -> Result<Vec<u8>, String> {
        let index = monitor.or_else(|| monitor_of(window));
        let _hidden = if hide { Some(Hidden::hide(app, window)) } else { None };
        Ok(capture_monitor_png(index)?.0)
    }
}

#[cfg(not(windows))]
mod native {
    use super::ClipMonitor;
    use tauri::{AppHandle, WebviewWindow};

    const NO: &str = "El recorte nativo todavía solo está disponible en Windows.";

    pub fn list_monitors() -> Result<Vec<ClipMonitor>, String> {
        Err(NO.into())
    }

    pub fn capture(_app: &AppHandle, _window: &WebviewWindow, _monitor: Option<usize>, _hide: bool) -> Result<Vec<u8>, String> {
        Err(NO.into())
    }
}

/// Los monitores del sistema.
#[tauri::command(async)]
pub fn clip_monitors() -> Result<Vec<ClipMonitor>, String> {
    native::list_monitors()
}

/// El PNG de un monitor (el de la ventana que lo pide si no se dice cuál). Con `hide`, las ventanas de la aplicación se ocultan mientras se captura.
#[tauri::command(async)]
pub fn clip_capture(app: AppHandle, window: WebviewWindow, monitor: Option<usize>, hide: bool) -> Result<Response, String> {
    native::capture(&app, &window, monitor, hide).map(Response::new)
}

#[cfg(all(test, windows))]
mod tests {
    use super::native::*;

    /// Needs a desktop session (it captures the real screen), so it is skipped when there is none.
    #[test]
    fn captures_the_primary_monitor_as_a_png_of_its_size() {
        let Ok(list) = list_monitors() else { return };
        assert!(list.iter().any(|m| m.primary), "hay un monitor principal");
        let (png, info) = capture_monitor_png(None).expect("captura");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n", "es un PNG");
        // the IHDR chunk holds width and height as big-endian integers at bytes 16..24
        let w = u32::from_be_bytes(png[16..20].try_into().unwrap());
        let h = u32::from_be_bytes(png[20..24].try_into().unwrap());
        assert_eq!((w, h), (info.width, info.height));
        assert!(w >= 640 && h >= 480);
    }

    #[test]
    fn an_unknown_monitor_is_an_error_not_a_panic() {
        if list_monitors().is_err() {
            return;
        }
        assert!(capture_monitor_png(Some(999)).is_err());
    }
}
