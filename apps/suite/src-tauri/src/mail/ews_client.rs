//! Exchange Web Services (SOAP sobre HTTPS): Exchange local y los servicios de Microsoft que todavía lo permiten.
//! Los mensajes se bajan y se suben como MIME, así que el resto de Nova Mail los trata igual que los de IMAP.
//!
//! Solo contraseña básica o token de OAuth (no NTLM ni Kerberos). Exchange Online empieza a bloquear EWS a las
//! aplicaciones externas desde el 1 de octubre de 2026: para Microsoft 365 usa IMAP con OAuth.

use super::account::{Account, AuthKind};
use super::backend::{check_flag, Backend, Creds, Fetched, FolderState, RemoteFolder, RemoteMessage, Skipped, StateItem};
use super::http::{agent, checked, explain, read_limited};
use super::tls::clean;
use base64::Engine;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;

const NS: &str = "xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:t=\"http://schemas.microsoft.com/exchange/services/2006/types\" xmlns:m=\"http://schemas.microsoft.com/exchange/services/2006/messages\"";
const PAGE: usize = 500;
const MAX_RESPONSE: u64 = 120 * 1024 * 1024;

// ------------------------------------------------------------------ un XML mínimo

#[derive(Debug, Default, Clone)]
pub struct Node {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub text: String,
    pub children: Vec<Node>,
}

impl Node {
    pub fn attr(&self, k: &str) -> Option<&str> {
        self.attrs.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
    }
    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.name == name)
    }
    pub fn text_of(&self, name: &str) -> &str {
        self.child(name).map(|c| c.text.as_str()).unwrap_or("")
    }
    /// Todos los descendientes con ese nombre.
    pub fn all<'a>(&'a self, name: &str, out: &mut Vec<&'a Node>) {
        for c in &self.children {
            if c.name == name {
                out.push(c);
            }
            c.all(name, out);
        }
    }
    pub fn find_all(&self, name: &str) -> Vec<&Node> {
        let mut v = vec![];
        self.all(name, &mut v);
        v
    }
}

pub fn parse_xml(text: &str) -> Result<Node, String> {
    let mut r = Reader::from_str(text);
    let mut stack: Vec<Node> = vec![Node::default()];
    let name_of = |b: &quick_xml::events::BytesStart| String::from_utf8_lossy(b.local_name().as_ref()).to_string();
    let attrs_of = |b: &quick_xml::events::BytesStart| -> Vec<(String, String)> {
        b.attributes().flatten().filter(|a| !a.key.as_ref().starts_with(b"xmlns")).map(|a| (String::from_utf8_lossy(a.key.local_name().as_ref()).to_string(), a.unescape_value().map(|v| v.to_string()).unwrap_or_default())).collect()
    };
    loop {
        match r.read_event().map_err(|e| format!("La respuesta del servidor no es XML válido: {e}"))? {
            Event::Start(b) => stack.push(Node { name: name_of(&b), attrs: attrs_of(&b), ..Default::default() }),
            Event::Empty(b) => {
                let n = Node { name: name_of(&b), attrs: attrs_of(&b), ..Default::default() };
                stack.last_mut().unwrap().children.push(n);
            }
            Event::End(_) => {
                let n = stack.pop().ok_or("XML mal formado.")?;
                stack.last_mut().ok_or("XML mal formado.")?.children.push(n);
            }
            Event::Text(t) => stack.last_mut().unwrap().text.push_str(&t.unescape().map_err(|e| e.to_string())?),
            Event::CData(t) => stack.last_mut().unwrap().text.push_str(&String::from_utf8_lossy(&t)),
            Event::Eof => break,
            _ => {}
        }
    }
    if stack.len() != 1 {
        return Err("La respuesta del servidor no es XML válido.".into());
    }
    Ok(stack.pop().unwrap())
}

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn id_ok(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 1024 || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=-_".contains(&b)) {
        return Err("El identificador no es válido.".into());
    }
    Ok(())
}

fn ids_ok(keys: &[String]) -> Result<(), String> {
    if keys.is_empty() || keys.len() > 5000 {
        return Err("Hay que indicar entre 1 y 5000 mensajes.".into());
    }
    keys.iter().try_for_each(|k| id_ok(k))
}

// ------------------------------------------------------------------ el cliente

pub struct Ews {
    agent: ureq::Agent,
    auth: String,
    url: String,
}

const ROLES: [(&str, &str); 6] = [("inbox", "\\Inbox"), ("sentitems", "\\Sent"), ("drafts", "\\Drafts"), ("deleteditems", "\\Trash"), ("junkemail", "\\Junk"), ("archive", "\\Archive")];

impl Ews {
    pub fn connect(account: &Account, creds: &Creds) -> Result<Ews, String> {
        let url = checked("Exchange", account.url.as_deref().ok_or("Exchange: falta la dirección del servicio.")?)?;
        let auth = match creds {
            Creds::Token(t) => format!("Bearer {t}"),
            Creds::Password(p) => {
                if account.auth.kind == AuthKind::Oauth {
                    return Err("Exchange con OAuth necesita un token.".into());
                }
                format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{}:{p}", account.username)))
            }
        };
        let mut me = Ews { agent: agent()?, auth, url };
        // una petición barata comprueba el acceso
        me.request("<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id=\"msgfolderroot\"/></m:FolderIds></m:GetFolder>")?;
        Ok(me)
    }

    /// Envía una operación y devuelve los mensajes de respuesta (uno por elemento). Falla si el servicio devuelve un error global.
    fn request(&mut self, body: &str) -> Result<Vec<Node>, String> {
        let xml = format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><soap:Envelope {NS}><soap:Header><t:RequestServerVersion Version=\"Exchange2013_SP1\"/></soap:Header><soap:Body>{body}</soap:Body></soap:Envelope>");
        let resp = self.agent.post(&self.url).set("Authorization", &self.auth).set("Content-Type", "text/xml; charset=utf-8").set("Accept", "text/xml").send_string(&xml);
        let text = match resp {
            Ok(r) => String::from_utf8_lossy(&read_limited(r, MAX_RESPONSE)?).to_string(),
            // los errores SOAP llegan con código 500 y un cuerpo con la explicación
            Err(ureq::Error::Status(500, r)) => String::from_utf8_lossy(&read_limited(r, 1_000_000)?).to_string(),
            Err(e) => return Err(explain(e)),
        };
        let doc = parse_xml(&text)?;
        if let Some(f) = doc.find_all("Fault").first() {
            return Err(format!("Exchange devolvió un error: {}", clean(f.text_of("faultstring"))));
        }
        Ok(doc.find_all("ResponseMessages").first().map(|rm| rm.children.clone()).unwrap_or_default())
    }

    /// Como `request`, pero cualquier respuesta con error es un fallo.
    fn run(&mut self, body: &str) -> Result<Vec<Node>, String> {
        let msgs = self.request(body)?;
        for m in &msgs {
            if m.attr("ResponseClass") == Some("Error") {
                return Err(format!("Exchange rechazó la operación ({}): {}", m.text_of("ResponseCode"), clean(m.text_of("MessageText"))));
            }
        }
        Ok(msgs)
    }

    fn roles(&mut self) -> Result<HashMap<String, &'static str>, String> {
        let ids: String = ROLES.iter().map(|(d, _)| format!("<t:DistinguishedFolderId Id=\"{d}\"/>")).collect();
        let msgs = self.request(&format!("<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds>{ids}</m:FolderIds></m:GetFolder>"))?;
        let mut out = HashMap::new();
        for (m, (_, attr)) in msgs.iter().zip(ROLES.iter()) {
            if m.attr("ResponseClass") == Some("Error") {
                continue; // p. ej. no hay carpeta de archivo
            }
            if let Some(f) = m.find_all("FolderId").first() {
                if let Some(id) = f.attr("Id") {
                    out.insert(id.to_string(), *attr);
                }
            }
        }
        Ok(out)
    }

    fn root_id(&mut self) -> Result<String, String> {
        let msgs = self.run("<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id=\"msgfolderroot\"/></m:FolderIds></m:GetFolder>")?;
        msgs.first().and_then(|m| m.find_all("FolderId").first().and_then(|f| f.attr("Id").map(|s| s.to_string()))).ok_or_else(|| "Exchange no devolvió la carpeta raíz.".to_string())
    }

    fn items(keys: &[String]) -> String {
        keys.iter().map(|k| format!("<t:ItemId Id=\"{}\"/>", esc(k))).collect()
    }
}

fn read_flag(flag: &Node) -> bool {
    flag.text_of("FlagStatus") == "Flagged"
}

impl Backend for Ews {
    fn list_folders(&mut self) -> Result<Vec<RemoteFolder>, String> {
        let roles = self.roles()?;
        let root = self.root_id()?;
        let msgs = self.run("<m:FindFolder Traversal=\"Deep\"><m:FolderShape><t:BaseShape>Default</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI=\"folder:ParentFolderId\"/><t:FieldURI FieldURI=\"folder:FolderClass\"/></t:AdditionalProperties></m:FolderShape><m:ParentFolderId><t:DistinguishedFolderId Id=\"msgfolderroot\"/></m:ParentFolderId></m:FindFolder>")?;
        struct F {
            id: String,
            parent: String,
            name: String,
        }
        let mut all: Vec<F> = vec![];
        for m in &msgs {
            for f in m.find_all("Folder") {
                let class = f.text_of("FolderClass");
                if !(class.is_empty() || class.starts_with("IPF.Note")) {
                    continue;
                }
                let (Some(id), Some(parent)) = (f.child("FolderId").and_then(|x| x.attr("Id")), f.child("ParentFolderId").and_then(|x| x.attr("Id"))) else { continue };
                all.push(F { id: id.to_string(), parent: parent.to_string(), name: f.text_of("DisplayName").to_string() });
            }
        }
        let by_id: HashMap<&str, &F> = all.iter().map(|f| (f.id.as_str(), f)).collect();
        let mut out = vec![];
        for f in &all {
            let mut parts = vec![f.name.clone()];
            let mut cur = f.parent.as_str();
            for _ in 0..30 {
                if cur == root {
                    break;
                }
                let Some(p) = by_id.get(cur) else { break };
                parts.push(p.name.clone());
                cur = p.parent.as_str();
            }
            parts.reverse();
            let attrs = roles.get(&f.id).map(|a| vec![a.to_string()]).unwrap_or_default();
            out.push(RemoteFolder { name: f.id.clone(), path: parts.join("/"), delimiter: Some("/".into()), attrs });
        }
        Ok(out)
    }

    fn folder_state(&mut self, folder: &str) -> Result<FolderState, String> {
        id_ok(folder)?;
        let mut items = vec![];
        let mut offset = 0;
        loop {
            let msgs = self.run(&format!(
                "<m:FindItem Traversal=\"Shallow\"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI=\"item:Size\"/><t:FieldURI FieldURI=\"message:IsRead\"/><t:FieldURI FieldURI=\"item:Flag\"/></t:AdditionalProperties></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned=\"{PAGE}\" Offset=\"{offset}\" BasePoint=\"Beginning\"/><m:SortOrder><t:FieldOrder Order=\"Descending\"><t:FieldURI FieldURI=\"item:DateTimeReceived\"/></t:FieldOrder></m:SortOrder><m:ParentFolderIds><t:FolderId Id=\"{}\"/></m:ParentFolderIds></m:FindItem>",
                esc(folder)
            ))?;
            let root = msgs.first().ok_or("Exchange no devolvió la lista de mensajes.")?;
            let got = root.find_all("Message");
            for m in &got {
                let Some(id) = m.child("ItemId").and_then(|x| x.attr("Id")) else { continue };
                let mut flags = vec![];
                if m.text_of("IsRead") == "true" {
                    flags.push("\\Seen".to_string());
                }
                if m.child("Flag").map_or(false, read_flag) {
                    flags.push("\\Flagged".to_string());
                }
                items.push(StateItem { key: id.to_string(), flags, size: m.text_of("Size").parse().unwrap_or(0) });
            }
            let last = root.find_all("RootFolder").first().map_or(true, |r| r.attr("IncludesLastItemInRange") != Some("false"));
            if got.is_empty() || last || items.len() > 200_000 {
                break;
            }
            offset += got.len();
        }
        Ok(FolderState { validity: "ews".into(), items, mirror_deletions: true })
    }

    fn fetch(&mut self, _folder: &str, keys: &[String], max_bytes: u32) -> Result<Fetched, String> {
        ids_ok(keys)?;
        let mut out = Fetched::default();
        for chunk in keys.chunks(10) {
            // primero los tamaños, para no bajar lo que no cabe
            let msgs = self.run(&format!("<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI=\"item:Size\"/></t:AdditionalProperties></m:ItemShape><m:ItemIds>{}</m:ItemIds></m:GetItem>", Ews::items(chunk)))?;
            let mut want: Vec<String> = vec![];
            for m in &msgs {
                for it in m.find_all("Message") {
                    let Some(id) = it.child("ItemId").and_then(|x| x.attr("Id")) else { continue };
                    let size: u32 = it.text_of("Size").parse().unwrap_or(0);
                    if size > max_bytes {
                        out.skipped.push(Skipped { key: id.to_string(), size });
                    } else {
                        want.push(id.to_string());
                    }
                }
            }
            if want.is_empty() {
                continue;
            }
            let msgs = self.run(&format!("<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:IncludeMimeContent>true</t:IncludeMimeContent><t:AdditionalProperties><t:FieldURI FieldURI=\"message:IsRead\"/><t:FieldURI FieldURI=\"item:Flag\"/></t:AdditionalProperties></m:ItemShape><m:ItemIds>{}</m:ItemIds></m:GetItem>", Ews::items(&want)))?;
            for m in &msgs {
                for it in m.find_all("Message") {
                    let Some(id) = it.child("ItemId").and_then(|x| x.attr("Id")) else { continue };
                    let mime: String = it.text_of("MimeContent").chars().filter(|c| !c.is_whitespace()).collect();
                    if mime.is_empty() {
                        continue;
                    }
                    let mut flags = vec![];
                    if it.text_of("IsRead") == "true" {
                        flags.push("\\Seen".to_string());
                    }
                    if it.child("Flag").map_or(false, read_flag) {
                        flags.push("\\Flagged".to_string());
                    }
                    out.messages.push(RemoteMessage { key: id.to_string(), flags, raw: mime });
                }
            }
        }
        Ok(out)
    }

    fn set_flag(&mut self, _folder: &str, keys: &[String], flag: &str, on: bool) -> Result<(), String> {
        let flag = check_flag(flag)?;
        ids_ok(keys)?;
        let update = match flag {
            "\\Seen" => format!("<t:SetItemField><t:FieldURI FieldURI=\"message:IsRead\"/><t:Message><t:IsRead>{on}</t:IsRead></t:Message></t:SetItemField>"),
            "\\Flagged" => format!("<t:SetItemField><t:FieldURI FieldURI=\"item:Flag\"/><t:Message><t:Flag><t:FlagStatus>{}</t:FlagStatus></t:Flag></t:Message></t:SetItemField>", if on { "Flagged" } else { "NotFlagged" }),
            // Exchange guarda «respondido» en una propiedad que no se cambia con una orden simple
            _ => return Ok(()),
        };
        for chunk in keys.chunks(100) {
            let changes: String = chunk.iter().map(|k| format!("<t:ItemChange><t:ItemId Id=\"{}\"/><t:Updates>{update}</t:Updates></t:ItemChange>", esc(k))).collect();
            self.run(&format!("<m:UpdateItem MessageDisposition=\"SaveOnly\" ConflictResolution=\"AlwaysOverwrite\"><m:ItemChanges>{changes}</m:ItemChanges></m:UpdateItem>"))?;
        }
        Ok(())
    }

    fn move_to(&mut self, _folder: &str, keys: &[String], to: &str) -> Result<(), String> {
        ids_ok(keys)?;
        id_ok(to)?;
        for chunk in keys.chunks(100) {
            self.run(&format!("<m:MoveItem><m:ToFolderId><t:FolderId Id=\"{}\"/></m:ToFolderId><m:ItemIds>{}</m:ItemIds></m:MoveItem>", esc(to), Ews::items(chunk)))?;
        }
        Ok(())
    }

    fn remove(&mut self, _folder: &str, keys: &[String]) -> Result<(), String> {
        ids_ok(keys)?;
        for chunk in keys.chunks(100) {
            self.run(&format!("<m:DeleteItem DeleteType=\"HardDelete\"><m:ItemIds>{}</m:ItemIds></m:DeleteItem>", Ews::items(chunk)))?;
        }
        Ok(())
    }

    fn append(&mut self, folder: &str, raw: &[u8], seen: bool) -> Result<(), String> {
        id_ok(folder)?;
        let mime = base64::engine::general_purpose::STANDARD.encode(raw);
        // PR_MESSAGE_FLAGS (0x0E07): 1 = leído, 0 = sin leer; sin esto el servidor lo trataría como un borrador
        self.run(&format!(
            "<m:CreateItem MessageDisposition=\"SaveOnly\"><m:SavedItemFolderId><t:FolderId Id=\"{}\"/></m:SavedItemFolderId><m:Items><t:Message><t:MimeContent CharacterSet=\"UTF-8\">{mime}</t:MimeContent><t:ExtendedProperty><t:ExtendedFieldURI PropertyTag=\"3591\" PropertyType=\"Integer\"/><t:Value>{}</t:Value></t:ExtendedProperty></t:Message></m:Items></m:CreateItem>",
            esc(folder),
            if seen { 1 } else { 0 }
        ))?;
        Ok(())
    }

    fn create_folder(&mut self, path: &str) -> Result<(), String> {
        let mut segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let Some(name) = segs.pop() else { return Err("Falta el nombre de la carpeta.".into()) };
        let parent = if segs.is_empty() {
            "<t:DistinguishedFolderId Id=\"msgfolderroot\"/>".to_string()
        } else {
            let want = segs.join("/");
            let id = self.list_folders()?.into_iter().find(|f| f.path == want).ok_or("La carpeta superior no existe en el servidor.")?.name;
            format!("<t:FolderId Id=\"{}\"/>", esc(&id))
        };
        self.run(&format!("<m:CreateFolder><m:ParentFolderId>{parent}</m:ParentFolderId><m:Folders><t:Folder><t:DisplayName>{}</t:DisplayName></t:Folder></m:Folders></m:CreateFolder>", esc(name)))?;
        Ok(())
    }

    fn delete_folder(&mut self, folder: &str) -> Result<(), String> {
        id_ok(folder)?;
        self.run(&format!("<m:DeleteFolder DeleteType=\"MoveToDeletedItems\"><m:FolderIds><t:FolderId Id=\"{}\"/></m:FolderIds></m:DeleteFolder>", esc(folder)))?;
        Ok(())
    }

    fn send(&mut self, _from: &str, recipients: &[String], raw: &[u8]) -> Result<(), String> {
        if recipients.is_empty() {
            return Err("Falta algún destinatario.".into());
        }
        // Exchange toma los destinatarios de las cabeceras del MIME: los ocultos (Cco) no están en el mensaje, se añaden
        // como cabecera Bcc, que Exchange quita al entregar.
        let text = String::from_utf8_lossy(raw).to_string();
        let split = text.find("\r\n\r\n").ok_or("El mensaje no tiene cabeceras.")?;
        let head = text[..split].to_lowercase();
        let hidden: Vec<&String> = recipients.iter().filter(|r| !head.contains(&r.to_lowercase())).collect();
        let mut mime = text.clone();
        if !hidden.is_empty() {
            mime = format!("{}\r\nBcc: {}{}", &text[..split], hidden.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "), &text[split..]);
        }
        let b64 = base64::engine::general_purpose::STANDARD.encode(mime.as_bytes());
        self.run(&format!("<m:CreateItem MessageDisposition=\"SendAndSaveCopy\"><m:SavedItemFolderId><t:DistinguishedFolderId Id=\"sentitems\"/></m:SavedItemFolderId><m:Items><t:Message><t:MimeContent CharacterSet=\"UTF-8\">{b64}</t:MimeContent></t:Message></m:Items></m:CreateItem>"))?;
        Ok(())
    }

    fn logout(self: Box<Self>) {}
}
