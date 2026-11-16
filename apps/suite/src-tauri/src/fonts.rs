//! Fuentes del sistema para el WordArt. El WebView2 de Tauri no responde a `queryLocalFonts()` (el permiso `local-fonts` se queda en
//! «prompt» y la promesa no termina), así que la web pide las fuentes a estos comandos: uno lista las instaladas (familia y estilo) y
//! otro entrega los bytes de una de la lista. Solo se leen archivos TrueType/OpenType de las carpetas de fuentes del sistema.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Clone, Serialize)]
pub struct SystemFont {
    /// Posición en la lista; es lo que se pasa a `system_font_bytes`.
    pub id: usize,
    pub family: String,
    pub style: String,
}

struct Entry {
    path: PathBuf,
    family: String,
    style: String,
}

fn font_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if cfg!(windows) {
        let root = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        v.push(root.join("Fonts"));
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            v.push(PathBuf::from(l).join(r"Microsoft\Windows\Fonts"));
        }
    } else {
        v.push(PathBuf::from("/usr/share/fonts"));
        v.push(PathBuf::from("/usr/local/share/fonts"));
        v.push(PathBuf::from("/Library/Fonts"));
        v.push(PathBuf::from("/System/Library/Fonts"));
        if let Some(h) = std::env::var_os("HOME") {
            v.push(PathBuf::from(&h).join(".fonts"));
            v.push(PathBuf::from(&h).join(".local/share/fonts"));
            v.push(PathBuf::from(&h).join("Library/Fonts"));
        }
    }
    v
}

fn u16_at(b: &[u8], o: usize) -> Option<usize> {
    Some(u16::from_be_bytes(b.get(o..o + 2)?.try_into().ok()?) as usize)
}
fn u32_at(b: &[u8], o: usize) -> Option<usize> {
    Some(u32::from_be_bytes(b.get(o..o + 4)?.try_into().ok()?) as usize)
}

/// Texto de un registro de la tabla `name` (UTF-16 BE en Windows y Unicode; Mac Roman se trata como ASCII).
fn name_string(b: &[u8], platform: usize) -> Option<String> {
    let s = b;
    if platform == 3 || platform == 0 {
        let units: Vec<u16> = s.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        String::from_utf16(&units).ok()
    } else {
        Some(s.iter().map(|&c| c as char).collect())
    }
}

/// Familia y estilo de una fuente TrueType/OpenType suelta (no colecciones `.ttc`).
fn read_names(data: &[u8]) -> Option<(String, String)> {
    let tag = data.get(0..4)?;
    if tag != [0, 1, 0, 0] && tag != b"OTTO" && tag != b"true" {
        return None;
    }
    let n_tables = u16_at(data, 4)?;
    let mut name_off = None;
    for i in 0..n_tables {
        let r = 12 + i * 16;
        if data.get(r..r + 4)? == b"name" {
            name_off = Some(u32_at(data, r + 8)?);
            break;
        }
    }
    let t = name_off?;
    let count = u16_at(data, t + 2)?;
    let str_off = t + u16_at(data, t + 4)?;
    let (mut fam1, mut sty2, mut fam16, mut sty17) = (None, None, None, None);
    for i in 0..count {
        let r = t + 6 + i * 12;
        let platform = u16_at(data, r)?;
        let lang = u16_at(data, r + 4)?;
        let id = u16_at(data, r + 6)?;
        let len = u16_at(data, r + 8)?;
        let off = u16_at(data, r + 10)?;
        if !(id == 1 || id == 2 || id == 16 || id == 17) {
            continue;
        }
        // se prefiere inglés de Windows (0x409) o Mac; cualquier otro idioma solo si no hay nada mejor
        let english = (platform == 3 && lang == 0x409) || (platform == 1 && lang == 0);
        let bytes = data.get(str_off + off..str_off + off + len)?;
        let Some(text) = name_string(bytes, platform) else { continue };
        let slot = match id {
            1 => &mut fam1,
            2 => &mut sty2,
            16 => &mut fam16,
            _ => &mut sty17,
        };
        if slot.is_none() || english {
            *slot = Some(text);
        }
    }
    let family = fam16.or(fam1)?;
    let style = sty17.or(sty2).unwrap_or_else(|| "Regular".to_string());
    Some((family, style))
}

fn scan(dir: &Path, depth: usize, out: &mut Vec<Entry>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth < 3 {
                scan(&p, depth + 1, out);
            }
            continue;
        }
        let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        if ext != "ttf" && ext != "otf" {
            continue;
        }
        // solo hacen falta los nombres, que están al principio del archivo en la práctica; se lee entero porque son pocos cientos
        let Ok(data) = std::fs::read(&p) else { continue };
        if let Some((family, style)) = read_names(&data) {
            out.push(Entry { path: p, family, style });
        }
    }
}

fn entries() -> &'static Vec<Entry> {
    static LIST: OnceLock<Vec<Entry>> = OnceLock::new();
    LIST.get_or_init(|| {
        let mut v = Vec::new();
        for d in font_dirs() {
            scan(&d, 0, &mut v);
        }
        v
    })
}

/// Las fuentes del sistema (familia y estilo). La primera llamada recorre las carpetas; las demás usan la lista guardada.
#[tauri::command]
pub async fn system_fonts() -> Vec<SystemFont> {
    tauri::async_runtime::spawn_blocking(|| entries().iter().enumerate().map(|(id, e)| SystemFont { id, family: e.family.clone(), style: e.style.clone() }).collect())
        .await
        .unwrap_or_default()
}

/// Los bytes de la fuente `id` de la lista de `system_fonts` (nada más: no se lee ningún otro archivo).
#[tauri::command]
pub async fn system_font_bytes(id: usize) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let e = entries().get(id).ok_or_else(|| "fuente desconocida".to_string())?;
        std::fs::read(&e.path).map_err(|x| x.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_fonts() {
        assert!(read_names(b"not a font at all").is_none());
        assert!(read_names(&[]).is_none());
    }

    #[test]
    fn reads_names_of_an_installed_font() {
        // en Windows, Arial viene siempre con el sistema
        if !cfg!(windows) {
            return;
        }
        let list = entries();
        assert!(list.iter().any(|e| e.family == "Arial"), "Arial no está en la lista");
        assert!(list.iter().any(|e| e.family == "Arial" && e.style == "Bold"));
    }
}
