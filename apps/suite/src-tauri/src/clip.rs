//! Recorte de pantalla nativo. El WebView solo puede capturar lo que el sistema le deja elegir en su selector (y la propia ventana de SuiteNova sale en la
//! captura); aquí se oculta la aplicación, se captura el monitor y se vuelve a mostrar, como hace Office. Dos comandos:
//! - `clip_monitors`: los monitores (posición y tamaño en píxeles físicos, escala, si es el principal).
//! - `clip_capture`: el PNG de un monitor (por defecto, el de la ventana que lo pide), con la aplicación oculta si se pide.
//! - `clip_pick`: como Office, oculta la aplicación, congela **todos** los monitores y abre en cada uno una ventana sin bordes, siempre encima, donde se
//!   arrastra la zona; devuelve el monitor y la zona (o `None` si se cancela). `clip_shot` da la captura congelada de un monitor y `clip_release` la suelta.
//! El PNG se entrega como bytes sin pasar por JSON (una captura de 4K son varios MB).
//! Solo en Windows por ahora: en los demás sistemas los comandos devuelven un error y la web usa el selector del navegador.

use serde::{Deserialize, Serialize};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{AppHandle, State, WebviewWindow};

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

/// Zona elegida, en píxeles de la captura del monitor.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PickRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Lo que devuelve la selección: el monitor y la zona (sin zona: toda la pantalla).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PickResult {
    pub monitor: usize,
    pub rect: Option<PickRect>,
}

/// Capturas congeladas mientras se elige la zona y quién espera la respuesta.
#[derive(Default)]
pub struct ClipState {
    shots: Mutex<Vec<(Vec<u8>, ClipMonitor)>>,
    tx: Mutex<Option<Sender<Option<PickResult>>>>,
}

#[cfg(windows)]
mod native {
    use super::{ClipMonitor, ClipState, PickResult};
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::{ExtendedColorType, ImageEncoder};
    use std::io::Cursor;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
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
        // la captura solo viaja de esta ventana a la página: se prima la velocidad sobre el tamaño (el PNG final lo vuelve a hacer la página al recortar)
        let mut out = Vec::with_capacity(img.as_raw().len() / 4);
        PngEncoder::new_with_quality(Cursor::new(&mut out), CompressionType::Fast, FilterType::NoFilter)
            .write_image(img.as_raw(), img.width(), img.height(), ExtendedColorType::Rgba8)
            .map_err(|e| format!("No se pudo guardar la captura: {e}"))?;
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

    /// Oculta la aplicación, congela todos los monitores y deja elegir la zona en una ventana sin bordes sobre cada uno. `None` si se cancela.
    pub fn pick(app: &AppHandle, window: &WebviewWindow, state: &ClipState) -> Result<Option<PickResult>, String> {
        // se declara primero para soltarse el último: la aplicación vuelve cuando ya no queda ninguna ventana de selección
        let _hidden = Hidden::hide(app, window);
        let count = monitors()?.len();
        let mut shots = Vec::new();
        for i in 0..count {
            shots.push(capture_monitor_png(Some(i))?);
        }
        *state.shots.lock().unwrap() = shots;
        let (tx, rx) = mpsc::channel();
        *state.tx.lock().unwrap() = Some(tx.clone());
        let mut labels: Vec<String> = Vec::new();
        let mut failure = None;
        for i in 0..count {
            let label = format!("clip-overlay-{i}");
            let url = WebviewUrl::App(format!("index.html?app=clip-overlay&monitor={i}").into());
            match WebviewWindowBuilder::new(app, &label, url).decorations(false).always_on_top(true).skip_taskbar(true).resizable(false).visible(false).title("Recorte de pantalla").build() {
                Ok(w) => {
                    let t = tx.clone();
                    // cerrar una ventana de selección (Alt+F4) cancela
                    w.on_window_event(move |e| {
                        if matches!(e, WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) {
                            let _ = t.send(None);
                        }
                    });
                    labels.push(label);
                }
                Err(e) => {
                    failure = Some(format!("No se pudo abrir la selección de zona: {e}"));
                    break;
                }
            }
        }
        let result = if let Some(f) = failure { Err(f) } else { Ok(rx.recv_timeout(Duration::from_secs(300)).unwrap_or(None)) };
        *state.tx.lock().unwrap() = None;
        for l in &labels {
            if let Some(w) = app.get_webview_window(l) {
                let _ = w.destroy();
            }
        }
        result
    }

    /// Coloca la ventana de selección sobre su monitor, a pantalla completa, y la muestra (la página la pide cuando ya ha dibujado la captura).
    pub fn overlay_ready(window: &WebviewWindow, state: &ClipState) -> Result<(), String> {
        let index: usize = window.label().rsplit('-').next().and_then(|n| n.parse().ok()).ok_or("ventana de selección desconocida")?;
        let info = state.shots.lock().unwrap().get(index).map(|s| s.1.clone()).ok_or("no hay captura para esa pantalla")?;
        // primero se lleva la ventana al monitor y luego se pone a pantalla completa: así cubre exactamente ese monitor (con solo posición y tamaño
        // Windows deja la ventana unos píxeles desplazada y más grande que el monitor)
        window.set_position(PhysicalPosition::new(info.x + 20, info.y + 20)).map_err(|e| e.to_string())?;
        window.set_size(PhysicalSize::new(info.width / 2, info.height / 2)).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_fullscreen(true).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
mod native {
    use super::{ClipMonitor, ClipState, PickResult};
    use tauri::{AppHandle, WebviewWindow};

    const NO: &str = "El recorte nativo todavía solo está disponible en Windows.";

    pub fn list_monitors() -> Result<Vec<ClipMonitor>, String> {
        Err(NO.into())
    }

    pub fn capture(_app: &AppHandle, _window: &WebviewWindow, _monitor: Option<usize>, _hide: bool) -> Result<Vec<u8>, String> {
        Err(NO.into())
    }

    pub fn pick(_app: &AppHandle, _window: &WebviewWindow, _state: &ClipState) -> Result<Option<PickResult>, String> {
        Err(NO.into())
    }

    pub fn overlay_ready(_window: &WebviewWindow, _state: &ClipState) -> Result<(), String> {
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

/// Elegir la zona sobre la pantalla real (ver arriba). `None` si se cancela.
#[tauri::command(async)]
pub fn clip_pick(app: AppHandle, window: WebviewWindow, state: State<'_, ClipState>) -> Result<Option<PickResult>, String> {
    native::pick(&app, &window, &state)
}

/// La captura congelada de un monitor (la de la última selección).
#[tauri::command]
pub fn clip_shot(state: State<'_, ClipState>, monitor: usize) -> Result<Response, String> {
    state.shots.lock().unwrap().get(monitor).map(|s| Response::new(s.0.clone())).ok_or_else(|| "No hay captura de esa pantalla.".to_string())
}

/// Suelta las capturas congeladas.
#[tauri::command]
pub fn clip_release(state: State<'_, ClipState>) {
    state.shots.lock().unwrap().clear();
}

/// La ventana de selección ya dibujó la captura: se coloca y se muestra.
#[tauri::command(async)]
pub fn clip_overlay_ready(window: WebviewWindow, state: State<'_, ClipState>) -> Result<(), String> {
    native::overlay_ready(&window, &state)
}

/// La ventana de selección termina: la zona elegida o `None` si se cancela.
#[tauri::command]
pub fn clip_pick_done(state: State<'_, ClipState>, result: Option<PickResult>) {
    if let Some(tx) = state.tx.lock().unwrap().as_ref() {
        let _ = tx.send(result);
    }
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
