use super::account::{Account, Auth, AuthKind, OAuth, Protocol, Security, Server};
use super::backend::{connect, Backend, Creds};
use super::fake::{folder, mail, FakeImap, FakePop3, FakeSmtp};
use super::fake_http::{eitem, jemail, FakeEws, FakeJmap, FakeOAuth};
use super::imap_client::Imap;
use super::smtp_client;
use super::store::tests::MemorySecrets;
use super::auth;
use base64::Engine;
use std::io::{Read, Write};
use std::time::Duration;

fn dec(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}

fn pw(s: &str) -> Creds {
    Creds::Password(s.into())
}

fn account(imap_port: u16, smtp_port: u16) -> Account {
    Account {
        id: "t1".into(),
        name: "Prueba".into(),
        email: "ana@ejemplo.es".into(),
        username: "ana".into(),
        imap: Server { host: "127.0.0.1".into(), port: imap_port, security: Security::None },
        smtp: Server { host: "127.0.0.1".into(), port: smtp_port, security: Security::None },
        protocol: Protocol::Imap,
        auth: Auth::default(),
        url: None,
        save_sent: None,
    }
}

fn web_account(protocol: Protocol, url: &str) -> Account {
    let mut a = account(1, 1);
    a.protocol = protocol;
    a.url = Some(url.into());
    a
}

fn keys(k: &[&str]) -> Vec<String> {
    k.iter().map(|s| s.to_string()).collect()
}

fn server() -> FakeImap {
    FakeImap::start(
        "ana",
        "clave",
        vec![
            folder("INBOX", &["\\HasNoChildren"], 777, vec![mail(1, &["\\Seen"], "Uno", "primero"), mail(2, &[], "Dos", "segundo"), mail(3, &["\\Flagged"], "Tres", "tercero"), mail(4, &[], "Cuatro", "cuarto"), mail(5, &[], "Cinco", "quinto")]),
            folder("Sent", &["\\HasNoChildren", "\\Sent"], 5, vec![]),
            folder("Drafts", &["\\Drafts"], 6, vec![]),
            folder("Trash", &["\\Trash"], 7, vec![]),
            folder("Trabajo/Proyecto A", &[], 8, vec![mail(1, &[], "Dentro", "hijo")]),
        ],
    )
}

fn imap(s: &FakeImap) -> Imap {
    Imap::connect(&account(s.port, 1), &pw("clave")).unwrap()
}

// ------------------------------------------------------------------ IMAP

#[test]
fn bad_password_gives_a_helpful_message_and_nothing_leaks_into_the_log() {
    let s = server();
    let a = account(s.port, 1);
    let e = Imap::connect(&a, &pw("equivocada")).err().unwrap();
    assert!(e.contains("contraseña de aplicación"), "{e}");
    assert!(!e.contains("equivocada"));
    assert!(s.log().iter().all(|l| !l.contains("clave") && !l.contains("equivocada")));
    assert!(Imap::connect(&a, &pw("clave")).is_ok());
}

#[test]
fn lists_every_folder_with_its_path_and_special_use() {
    let s = server();
    let mut c = imap(&s);
    let folders = c.list_folders().unwrap();
    assert_eq!(folders.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["INBOX", "Sent", "Drafts", "Trash", "Trabajo/Proyecto A"]);
    assert!(folders[1].attrs.iter().any(|a| a == "\\Sent"), "{:?}", folders[1].attrs);
    assert!(folders[2].attrs.iter().any(|a| a == "\\Drafts"));
    assert_eq!(folders[4].path, "Trabajo/Proyecto A");
    Box::new(c).logout();
}

#[test]
fn the_state_lists_every_message_with_flags_newest_first() {
    let s = server();
    let mut c = imap(&s);
    let st = c.folder_state("INBOX").unwrap();
    assert_eq!(st.validity, "777");
    assert!(st.mirror_deletions);
    assert_eq!(st.items.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(), ["5", "4", "3", "2", "1"]);
    assert_eq!(st.items[4].flags, ["\\Seen"]);
    assert_eq!(st.items[2].flags, ["\\Flagged"]);
    assert!(st.items[0].size > 20);
    // una carpeta vacía no es un error
    assert!(c.folder_state("Sent").unwrap().items.is_empty());
    assert!(c.folder_state("NoExiste").is_err());
}

#[test]
fn downloads_the_requested_messages_without_marking_them_read() {
    let s = server();
    let mut c = imap(&s);
    let r = c.fetch("INBOX", &keys(&["2", "4"]), 1_000_000).unwrap();
    assert_eq!(r.messages.iter().map(|m| m.key.as_str()).collect::<Vec<_>>(), ["2", "4"]);
    assert!(String::from_utf8(dec(&r.messages[0].raw)).unwrap().contains("Subject: Dos"));
    assert!(s.log().iter().all(|l| !l.contains("STORE")));
    assert!(s.log().iter().any(|l| l.contains("BODY.PEEK[]")));
    assert!(s.folder("INBOX").msgs[1].flags.is_empty());
    assert!(c.fetch("INBOX", &keys(&["x"]), 1000).is_err());
    assert!(c.fetch("INBOX", &[], 1000).is_err());
}

#[test]
fn huge_messages_are_skipped_without_downloading_them() {
    let big = "x".repeat(5000);
    let s = FakeImap::start("ana", "clave", vec![folder("INBOX", &[], 1, vec![mail(1, &[], "Pequeño", "hola"), mail(2, &[], "Enorme", &big)])]);
    let mut c = Imap::connect(&account(s.port, 1), &pw("clave")).unwrap();
    let r = c.fetch("INBOX", &keys(&["1", "2"]), 2000).unwrap();
    assert_eq!(r.messages.iter().map(|m| m.key.as_str()).collect::<Vec<_>>(), ["1"]);
    assert_eq!(r.skipped.iter().map(|x| x.key.as_str()).collect::<Vec<_>>(), ["2"]);
    assert!(r.skipped[0].size > 5000);
    assert!(s.log().iter().all(|l| !l.contains("FETCH 2 (UID FLAGS BODY.PEEK[])")), "no se pidió el cuerpo grande");
}

#[test]
fn flags_can_be_set_and_cleared_but_only_the_safe_ones() {
    let s = server();
    let mut c = imap(&s);
    c.set_flag("INBOX", &keys(&["2"]), "\\Seen", true).unwrap();
    assert_eq!(s.folder("INBOX").msgs[1].flags, ["\\Seen"]);
    c.set_flag("INBOX", &keys(&["2"]), "\\Seen", false).unwrap();
    assert!(s.folder("INBOX").msgs[1].flags.is_empty());
    c.set_flag("INBOX", &keys(&["4", "5"]), "\\Flagged", true).unwrap();
    assert_eq!(s.folder("INBOX").msgs[3].flags, ["\\Flagged"]);
    assert_eq!(s.folder("INBOX").msgs[4].flags, ["\\Flagged"]);
    assert!(c.set_flag("INBOX", &keys(&["2"]), "\\Deleted", true).is_err());
    assert!(c.set_flag("INBOX", &keys(&["2"]), "\\Seen) \\Deleted (", true).is_err());
    assert!(c.set_flag("INBOX", &keys(&["2:*"]), "\\Seen", true).is_err(), "los identificadores son números");
    assert!(s.log().iter().all(|l| !l.contains("Deleted")));
    assert!(c.set_flag("NoExiste", &keys(&["1"]), "\\Seen", true).is_err());
}

#[test]
fn moves_messages_to_another_folder_on_the_server() {
    let s = server();
    let mut c = imap(&s);
    c.move_to("INBOX", &keys(&["2", "3"]), "Trabajo/Proyecto A").unwrap();
    assert_eq!(s.folder("INBOX").msgs.iter().map(|m| m.uid).collect::<Vec<_>>(), [1, 4, 5]);
    let dest = s.folder("Trabajo/Proyecto A");
    assert_eq!(dest.msgs.len(), 3);
    assert!(String::from_utf8_lossy(&dest.msgs[1].raw).contains("Subject: Dos"));
    assert!(s.log().iter().any(|l| l.contains("UID MOVE")));
    assert!(c.move_to("INBOX", &keys(&["1"]), "NoExiste").is_err());
    assert_eq!(s.folder("INBOX").msgs.len(), 3, "si el destino no existe no se pierde nada");
}

#[test]
fn without_the_move_extension_it_copies_flags_and_expunges_only_those_messages() {
    let s = server();
    s.state.lock().unwrap().has_move = false;
    // otro mensaje ya marcado para borrar por otro cliente: no debe desaparecer
    s.state.lock().unwrap().folders[0].msgs[0].flags.push("\\Deleted".into());
    let mut c = imap(&s);
    c.move_to("INBOX", &keys(&["2"]), "Trash").unwrap();
    assert_eq!(s.folder("Trash").msgs.len(), 1);
    assert_eq!(s.folder("INBOX").msgs.iter().map(|m| m.uid).collect::<Vec<_>>(), [1, 3, 4, 5]);
    assert!(s.log().iter().any(|l| l.contains("UID COPY")));
    assert!(s.log().iter().any(|l| l.contains("UID EXPUNGE")), "con UIDPLUS solo se expulsan los indicados");
}

#[test]
fn removes_messages_for_good() {
    let s = server();
    let mut c = imap(&s);
    c.remove("INBOX", &keys(&["1", "5"])).unwrap();
    assert_eq!(s.folder("INBOX").msgs.iter().map(|m| m.uid).collect::<Vec<_>>(), [2, 3, 4]);
    assert!(c.remove("NoExiste", &keys(&["1"])).is_err());
}

#[test]
fn appends_a_copy_to_sent_with_the_seen_flag() {
    let s = server();
    let mut c = imap(&s);
    let raw = b"From: ana@ejemplo.es\r\nSubject: Enviado\r\n\r\ncuerpo\r\n";
    c.append("Sent", raw, true).unwrap();
    let f = s.folder("Sent");
    assert_eq!(f.msgs.len(), 1);
    assert_eq!(f.msgs[0].raw, raw);
    assert_eq!(f.msgs[0].flags, ["\\Seen"]);
    assert!(c.append("NoExiste", raw, false).is_err());
}

#[test]
fn creates_and_deletes_folders() {
    let s = server();
    let mut c = imap(&s);
    c.create_folder("Trabajo/Nuevo").unwrap();
    assert!(s.has_folder("Trabajo/Nuevo"));
    assert!(c.create_folder("Trabajo/Nuevo").is_err());
    c.delete_folder("Trabajo/Nuevo").unwrap();
    assert!(!s.has_folder("Trabajo/Nuevo"));
    assert!(c.delete_folder("Trabajo/Nuevo").is_err());
}

#[test]
fn oauth_logs_in_with_xoauth2_and_a_rejected_token_ends_cleanly() {
    let s = server();
    s.state.lock().unwrap().token = Some("TOKEN-BUENO".into());
    let a = account(s.port, 1);
    let mut c = Imap::connect(&a, &Creds::Token("TOKEN-BUENO".into())).unwrap();
    assert_eq!(c.list_folders().unwrap().len(), 5);
    let e = Imap::connect(&a, &Creds::Token("TOKEN-MALO".into())).err().unwrap();
    assert!(e.contains("OAuth"), "{e}");
    assert!(!e.contains("TOKEN"));
    // la contraseña no vale si el servidor exige OAuth
    assert!(Imap::connect(&a, &pw("clave")).is_err());
    assert!(s.log().iter().all(|l| !l.contains("TOKEN")), "el token no aparece en el diálogo registrado");
}

#[test]
fn the_dispatcher_opens_the_right_protocol() {
    let s = server();
    let mut b = connect(&account(s.port, 1), &pw("clave")).unwrap();
    assert_eq!(b.list_folders().unwrap().len(), 5);
    b.logout();
}

// ------------------------------------------------------------------ SMTP

#[test]
fn sends_with_the_hidden_recipients_in_the_envelope_only() {
    let smtp = FakeSmtp::start("ana", "clave");
    let a = account(1, smtp.port);
    let raw = b"From: ana@ejemplo.es\r\nTo: luis@ejemplo.es\r\nSubject: Hola\r\n\r\nlinea\r\n.punto al inicio\r\n..dos puntos\r\n";
    smtp_client::send(&a, &pw("clave"), "ana@ejemplo.es", &["luis@ejemplo.es".into(), "oculta@ejemplo.es".into()], raw).unwrap();
    let sent = smtp.sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].from, "ana@ejemplo.es");
    assert_eq!(sent[0].rcpts, ["luis@ejemplo.es", "oculta@ejemplo.es"]);
    assert_eq!(sent[0].data, raw);
    let sin = &raw[..raw.len() - 2];
    smtp_client::send(&a, &pw("clave"), "ana@ejemplo.es", &["luis@ejemplo.es".into()], sin).unwrap();
    assert_eq!(smtp.sent()[1].data, raw);
    assert!(!String::from_utf8_lossy(&sent[0].data).contains("oculta@"));
    assert!(smtp.state.lock().unwrap().log.iter().all(|l| !l.contains("clave")));
}

#[test]
fn smtp_errors_are_explained() {
    let smtp = FakeSmtp::start("ana", "clave");
    smtp.state.lock().unwrap().reject_domain = Some("malo.example".into());
    let a = account(1, smtp.port);
    let raw = b"From: ana@ejemplo.es\r\nSubject: x\r\n\r\ny\r\n";
    let e = smtp_client::send(&a, &pw("otra"), "ana@ejemplo.es", &["luis@ejemplo.es".into()], raw).unwrap_err();
    assert!(e.contains("contraseña de aplicación"), "{e}");
    let e = smtp_client::send(&a, &pw("clave"), "ana@ejemplo.es", &["x@malo.example".into()], raw).unwrap_err();
    assert!(e.to_lowercase().contains("smtp"), "{e}");
    assert!(smtp.sent().is_empty());
    assert!(smtp_client::send(&a, &pw("clave"), "ana@ejemplo.es", &[], raw).is_err());
    assert!(smtp_client::send(&a, &pw("clave"), "ana@ejemplo.es", &["no es una dirección".into()], raw).unwrap_err().contains("no es válida"));
    assert!(smtp_client::send(&a, &pw("clave"), "ana@ejemplo.es\r\nRCPT TO:<x@y.z>", &["luis@ejemplo.es".into()], raw).is_err());
    assert!(smtp_client::test(&a, &pw("clave")).is_ok());
    assert!(smtp_client::test(&a, &pw("mal")).is_err());
}

#[test]
fn smtp_sends_with_an_oauth_token() {
    let smtp = FakeSmtp::start("ana", "clave");
    smtp.state.lock().unwrap().token = Some("T-OK".into());
    let a = account(1, smtp.port);
    let raw = b"From: ana@ejemplo.es\r\nSubject: x\r\n\r\ny\r\n";
    smtp_client::send(&a, &Creds::Token("T-OK".into()), "ana@ejemplo.es", &["luis@ejemplo.es".into()], raw).unwrap();
    assert_eq!(smtp.sent().len(), 1);
    assert!(smtp_client::send(&a, &Creds::Token("T-MALO".into()), "ana@ejemplo.es", &["luis@ejemplo.es".into()], raw).is_err());
    assert!(smtp_client::send(&a, &pw("clave"), "ana@ejemplo.es", &["luis@ejemplo.es".into()], raw).is_err());
    assert_eq!(smtp.sent().len(), 1);
    assert!(smtp.state.lock().unwrap().log.iter().all(|l| !l.contains("T-OK")));
}

#[test]
fn unreachable_servers_fail_with_a_message() {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    let e = Imap::connect(&account(port, port), &pw("clave")).err().unwrap();
    assert!(e.contains("No se pudo conectar"), "{e}");
}

// ------------------------------------------------------------------ POP3

fn pop_msgs() -> Vec<(String, Vec<u8>)> {
    vec![
        ("uidl-aaa".into(), mail(1, &[], "Primero", "uno").raw),
        ("uidl-bbb".into(), mail(2, &[], "Segundo", "dos\r\n.punto al inicio\r\nfin").raw),
        ("uidl-ccc".into(), mail(3, &[], "Tercero", "tres").raw),
    ]
}

fn pop_account(port: u16) -> Account {
    let mut a = account(port, 1);
    a.protocol = Protocol::Pop3;
    a
}

#[test]
fn pop3_lists_one_folder_and_the_state_has_the_newest_first() {
    let s = FakePop3::start("ana", "clave", pop_msgs());
    let mut c = connect(&pop_account(s.port), &pw("clave")).unwrap();
    let f = c.list_folders().unwrap();
    assert_eq!(f.len(), 1);
    assert_eq!(f[0].name, "INBOX");
    let st = c.folder_state("INBOX").unwrap();
    assert!(!st.mirror_deletions, "en POP3 lo que ya no está en el servidor se conserva aquí");
    assert_eq!(st.items.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(), ["uidl-ccc", "uidl-bbb", "uidl-aaa"]);
    assert!(c.folder_state("Otra").is_err());
    c.logout();
}

#[test]
fn pop3_downloads_messages_and_restores_dots() {
    let s = FakePop3::start("ana", "clave", pop_msgs());
    let mut c = connect(&pop_account(s.port), &pw("clave")).unwrap();
    let r = c.fetch("INBOX", &keys(&["uidl-bbb", "uidl-aaa"]), 1_000_000).unwrap();
    assert_eq!(r.messages.len(), 2);
    let bbb = String::from_utf8(dec(&r.messages[0].raw)).unwrap();
    assert_eq!(bbb.as_bytes(), pop_msgs()[1].1.as_slice(), "el punto del inicio de línea llega intacto");
    assert!(r.messages[0].flags.is_empty());
    let r = c.fetch("INBOX", &keys(&["uidl-aaa"]), 10).unwrap();
    assert_eq!(r.skipped.len(), 1);
    assert!(c.fetch("INBOX", &keys(&["no-existe"]), 1000).is_err());
    c.logout();
    assert_eq!(s.uidls().len(), 3, "bajar no borra");
}

#[test]
fn pop3_deletes_only_when_the_session_ends_and_flags_stay_local() {
    let s = FakePop3::start("ana", "clave", pop_msgs());
    let mut c = connect(&pop_account(s.port), &pw("clave")).unwrap();
    c.remove("INBOX", &keys(&["uidl-bbb"])).unwrap();
    c.set_flag("INBOX", &keys(&["uidl-aaa"]), "\\Seen", true).unwrap();
    assert!(c.move_to("INBOX", &keys(&["uidl-aaa"]), "Otra").is_err());
    assert!(c.append("INBOX", b"x", true).is_err());
    assert!(c.create_folder("Nueva").is_err());
    assert_eq!(s.uidls().len(), 3, "mientras no se cierre la sesión no se borra");
    c.logout();
    assert_eq!(s.uidls(), ["uidl-aaa", "uidl-ccc"]);
}

#[test]
fn pop3_login_errors_and_oauth() {
    let s = FakePop3::start("ana", "clave", pop_msgs());
    let e = connect(&pop_account(s.port), &pw("mal")).err().unwrap();
    assert!(e.contains("contraseña de aplicación"), "{e}");
    assert!(s.log().iter().all(|l| !l.contains("clave") && !l.contains("mal")));
    s.state.lock().unwrap().token = Some("TOK".into());
    assert!(connect(&pop_account(s.port), &Creds::Token("TOK".into())).is_ok());
    let e = connect(&pop_account(s.port), &Creds::Token("MALO".into())).err().unwrap();
    assert!(e.contains("OAuth"), "{e}");
    assert!(s.log().iter().all(|l| !l.contains("TOK")));
}

// ------------------------------------------------------------------ JMAP

fn jmap_with_mail() -> FakeJmap {
    let s = FakeJmap::start("ana", "clave");
    {
        let mut st = s.state.lock().unwrap();
        st.emails = vec![jemail("e1", "mb-inbox", &["$seen"], "Uno", 100), jemail("e2", "mb-inbox", &[], "Dos", 200), jemail("e3", "mb-inbox", &["$flagged", "$answered"], "Tres", 300), jemail("e4", "mb-proj", &[], "Hijo", 50)];
    }
    s
}

fn jmap(s: &FakeJmap) -> Box<dyn Backend> {
    connect(&web_account(Protocol::Jmap, &s.url()), &pw("clave")).unwrap()
}

#[test]
fn jmap_lists_mailboxes_with_their_full_path_and_roles() {
    let s = jmap_with_mail();
    let mut c = jmap(&s);
    let f = c.list_folders().unwrap();
    let sent = f.iter().find(|x| x.name == "mb-sent").unwrap();
    assert!(sent.attrs.contains(&"\\Sent".to_string()));
    assert!(f.iter().find(|x| x.name == "mb-inbox").unwrap().attrs.contains(&"\\Inbox".to_string()));
    assert_eq!(f.iter().find(|x| x.name == "mb-proj").unwrap().path, "Trabajo/Proyecto A");
}

#[test]
fn jmap_state_fetch_and_flags() {
    let s = jmap_with_mail();
    let mut c = jmap(&s);
    let st = c.folder_state("mb-inbox").unwrap();
    assert_eq!(st.items.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(), ["e3", "e2", "e1"]);
    assert_eq!(st.items[0].flags, ["\\Flagged", "\\Answered"]);
    assert_eq!(st.items[2].flags, ["\\Seen"]);
    let r = c.fetch("mb-inbox", &keys(&["e2", "e1"]), 1_000_000).unwrap();
    assert_eq!(r.messages.len(), 2);
    assert!(String::from_utf8(dec(&r.messages.iter().find(|m| m.key == "e2").unwrap().raw)).unwrap().contains("Subject: Dos"));
    assert_eq!(c.fetch("mb-inbox", &keys(&["e2"]), 10).unwrap().skipped.len(), 1);
    c.set_flag("mb-inbox", &keys(&["e2"]), "\\Seen", true).unwrap();
    assert!(s.email("e2").unwrap().keywords.contains("$seen"));
    c.set_flag("mb-inbox", &keys(&["e2"]), "\\Seen", false).unwrap();
    assert!(!s.email("e2").unwrap().keywords.contains("$seen"));
    assert!(c.set_flag("mb-inbox", &keys(&["e2"]), "\\Deleted", true).is_err());
    assert!(c.fetch("mb-inbox", &keys(&["../x"]), 1000).is_err());
}

#[test]
fn jmap_moves_removes_and_appends() {
    let s = jmap_with_mail();
    let mut c = jmap(&s);
    c.move_to("mb-inbox", &keys(&["e2"]), "mb-trash").unwrap();
    assert_eq!(s.email("e2").unwrap().mailboxes, ["mb-trash"]);
    c.remove("mb-trash", &keys(&["e2"])).unwrap();
    assert!(s.email("e2").is_none());
    c.append("mb-sent", b"From: ana@ejemplo.es\r\nSubject: Copia\r\n\r\nx\r\n", true).unwrap();
    let st = s.state.lock().unwrap();
    let copy = st.emails.iter().find(|e| e.mailboxes == ["mb-sent"]).unwrap();
    assert!(copy.keywords.contains("$seen"));
    assert!(String::from_utf8_lossy(&copy.raw).contains("Subject: Copia"));
}

#[test]
fn jmap_sends_and_the_server_keeps_its_own_copy_in_sent() {
    let s = jmap_with_mail();
    let mut c = jmap(&s);
    let raw = b"From: ana@ejemplo.es\r\nTo: luis@ejemplo.es\r\nSubject: Hola\r\nMessage-ID: <nuevo@x>\r\n\r\ncuerpo\r\n";
    c.send("ana@ejemplo.es", &["luis@ejemplo.es".into(), "oculta@ejemplo.es".into()], raw).unwrap();
    let st = s.state.lock().unwrap();
    assert_eq!(st.submitted.len(), 1);
    assert_eq!(st.submitted[0].0, "ana@ejemplo.es");
    assert_eq!(st.submitted[0].1, ["luis@ejemplo.es", "oculta@ejemplo.es"]);
    let sent = st.emails.iter().find(|e| String::from_utf8_lossy(&e.raw).contains("nuevo@x")).unwrap();
    assert_eq!(sent.mailboxes, ["mb-sent"]);
    assert!(!sent.keywords.contains("$draft"));
    drop(st);
    s.state.lock().unwrap().reject_domain = Some("malo.example".into());
    let e = c.send("ana@ejemplo.es", &["x@malo.example".into()], raw).unwrap_err();
    assert!(e.contains("invalidRecipients"), "{e}");
}

#[test]
fn jmap_creates_subfolders_and_refuses_to_delete_a_full_one() {
    let s = jmap_with_mail();
    let mut c = jmap(&s);
    c.create_folder("Trabajo/Nuevo").unwrap();
    let f = c.list_folders().unwrap();
    assert!(f.iter().any(|x| x.path == "Trabajo/Nuevo"));
    assert!(c.create_folder("NoExiste/Hija").is_err());
    c.create_folder("Suelta").unwrap();
    let id = c.list_folders().unwrap().into_iter().find(|x| x.path == "Suelta").unwrap().name;
    c.delete_folder(&id).unwrap();
    assert!(c.delete_folder("mb-proj").is_err(), "tiene un mensaje: el servidor lo rechaza");
    assert!(c.delete_folder("mb-inbox").is_err());
}

#[test]
fn jmap_credentials_bearer_tokens_and_unsafe_addresses() {
    let s = jmap_with_mail();
    let e = connect(&web_account(Protocol::Jmap, &s.url()), &pw("mal")).err().unwrap();
    assert!(e.contains("no aceptó"), "{e}");
    s.state.lock().unwrap().token = Some("TOK".into());
    assert!(connect(&web_account(Protocol::Jmap, &s.url()), &Creds::Token("TOK".into())).is_ok());
    assert!(connect(&web_account(Protocol::Jmap, &s.url()), &pw("clave")).is_err());
    let mut bad = web_account(Protocol::Jmap, "http://mail.ejemplo.es/jmap");
    bad.url = Some("http://mail.ejemplo.es/jmap".into());
    assert!(connect(&bad, &pw("clave")).err().unwrap().contains("sin cifrar"));
}

// ------------------------------------------------------------------ Exchange (EWS)

fn ews_with_mail() -> FakeEws {
    let s = FakeEws::start("ana", "clave");
    {
        let mut st = s.state.lock().unwrap();
        st.items = vec![eitem("AAMkI1=", "AAMkINBOX+1=", true, "Uno", 100), eitem("AAMkI2=", "AAMkINBOX+1=", false, "Dos", 200), eitem("AAMkI3=", "AAMkINBOX+1=", false, "Tres", 300), eitem("AAMkP1=", "AAMkPROJ=", false, "Hijo", 50)];
        st.items[2].flagged = true;
    }
    s
}

fn ews(s: &FakeEws) -> Box<dyn Backend> {
    connect(&web_account(Protocol::Ews, &s.url()), &pw("clave")).unwrap()
}

#[test]
fn ews_lists_folders_with_paths_and_distinguished_roles() {
    let s = ews_with_mail();
    let mut c = ews(&s);
    let f = c.list_folders().unwrap();
    assert!(f.iter().find(|x| x.name == "AAMkINBOX+1=").unwrap().attrs.contains(&"\\Inbox".to_string()));
    assert!(f.iter().find(|x| x.name == "AAMkSENT/2=").unwrap().attrs.contains(&"\\Sent".to_string()));
    assert!(f.iter().find(|x| x.name == "AAMkTRASH=").unwrap().attrs.contains(&"\\Trash".to_string()));
    assert_eq!(f.iter().find(|x| x.name == "AAMkPROJ=").unwrap().path, "Trabajo/Proyecto A");
    assert!(f.iter().all(|x| x.path != "Raíz"));
}

#[test]
fn ews_state_fetch_and_flags() {
    let s = ews_with_mail();
    let mut c = ews(&s);
    let st = c.folder_state("AAMkINBOX+1=").unwrap();
    assert_eq!(st.items.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(), ["AAMkI3=", "AAMkI2=", "AAMkI1="]);
    assert_eq!(st.items[0].flags, ["\\Flagged"]);
    assert_eq!(st.items[2].flags, ["\\Seen"]);
    let r = c.fetch("AAMkINBOX+1=", &keys(&["AAMkI2=", "AAMkI3="]), 1_000_000).unwrap();
    assert_eq!(r.messages.len(), 2);
    assert!(String::from_utf8(dec(&r.messages[0].raw)).unwrap().contains("Subject: Dos"));
    assert_eq!(c.fetch("AAMkINBOX+1=", &keys(&["AAMkI2="]), 10).unwrap().skipped.len(), 1);
    c.set_flag("AAMkINBOX+1=", &keys(&["AAMkI2="]), "\\Seen", true).unwrap();
    assert!(s.item("AAMkI2=").unwrap().read);
    c.set_flag("AAMkINBOX+1=", &keys(&["AAMkI2="]), "\\Flagged", true).unwrap();
    assert!(s.item("AAMkI2=").unwrap().flagged);
    c.set_flag("AAMkINBOX+1=", &keys(&["AAMkI2="]), "\\Flagged", false).unwrap();
    assert!(!s.item("AAMkI2=").unwrap().flagged);
    assert!(c.set_flag("AAMkINBOX+1=", &keys(&["AAMkI2="]), "\\Answered", true).is_ok(), "sin efecto, pero no falla");
    assert!(c.fetch("AAMkINBOX+1=", &keys(&["\"><x"]), 1000).is_err(), "no se puede inyectar XML");
}

#[test]
fn ews_moves_removes_appends_and_sends_with_a_saved_copy() {
    let s = ews_with_mail();
    let mut c = ews(&s);
    c.move_to("AAMkINBOX+1=", &keys(&["AAMkI2="]), "AAMkTRASH=").unwrap();
    assert!(s.state.lock().unwrap().items.iter().any(|i| i.folder == "AAMkTRASH=" && String::from_utf8_lossy(&i.raw).contains("Dos")));
    assert!(c.move_to("AAMkINBOX+1=", &keys(&["AAMkI1="]), "NOEXISTE").is_err());
    c.remove("AAMkINBOX+1=", &keys(&["AAMkI1="])).unwrap();
    assert!(s.item("AAMkI1=").is_none());
    c.append("AAMkSENT/2=", b"From: ana@ejemplo.es\r\nSubject: Copia\r\n\r\nx\r\n", true).unwrap();
    assert!(s.state.lock().unwrap().items.iter().any(|i| i.folder == "AAMkSENT/2=" && i.read));
    let raw = b"From: ana@ejemplo.es\r\nTo: luis@ejemplo.es\r\nSubject: Hola\r\n\r\ncuerpo\r\n";
    c.send("ana@ejemplo.es", &["luis@ejemplo.es".into(), "oculta@ejemplo.es".into()], raw).unwrap();
    let st = s.state.lock().unwrap();
    assert_eq!(st.sent.len(), 1);
    let sent = String::from_utf8_lossy(&st.sent[0]).to_string();
    assert!(sent.contains("Bcc: oculta@ejemplo.es"));
    assert!(!sent.contains("Bcc: luis"));
    assert!(st.items.iter().any(|i| i.folder == "AAMkSENT/2=" && String::from_utf8_lossy(&i.raw).contains("Subject: Hola")), "Exchange guarda su copia en Elementos enviados");
}

#[test]
fn ews_creates_subfolders_and_reports_errors_and_credentials() {
    let s = ews_with_mail();
    let mut c = ews(&s);
    c.create_folder("Trabajo/Nuevo").unwrap();
    let f = c.list_folders().unwrap();
    let nuevo = f.iter().find(|x| x.path == "Trabajo/Nuevo").expect("la subcarpeta aparece");
    c.delete_folder(&nuevo.name.clone()).unwrap();
    assert!(c.create_folder("NoExiste/Hija").is_err());
    let e = connect(&web_account(Protocol::Ews, &s.url()), &pw("mal")).err().unwrap();
    assert!(e.contains("no aceptó"), "{e}");
    s.state.lock().unwrap().token = Some("TOK".into());
    assert!(connect(&web_account(Protocol::Ews, &s.url()), &Creds::Token("TOK".into())).is_ok());
}

// ------------------------------------------------------------------ OAuth

fn oauth_account(token_url: &str, auth_url: &str) -> Account {
    let mut a = account(1, 1);
    a.auth = Auth {
        kind: AuthKind::Oauth,
        oauth: Some(OAuth { provider: "custom".into(), client_id: "mi-cliente".into(), tenant: None, auth_url: Some(auth_url.into()), token_url: Some(token_url.into()), scope: Some("mail offline_access".into()) }),
    };
    a
}

fn http_get(url_path: &str, port: u16, host: &str) -> String {
    let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.write_all(format!("GET {url_path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes()).unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).ok();
    out
}

fn query(url: &str) -> std::collections::HashMap<String, String> {
    url.split_once('?').unwrap().1.split('&').filter_map(|kv| kv.split_once('=')).map(|(k, v)| (auth::pct_decode(k), auth::pct_decode(v))).collect()
}

/// Hace de navegador: abre la dirección de autorización y vuelve a la redirección con el código (o con lo que se indique).
fn browser<'a>(fake: &'a FakeOAuth, answer: impl Fn(&std::collections::HashMap<String, String>) -> String + Send + Sync + 'static + Clone) -> impl Fn(&str) -> Result<(), String> + 'a {
    move |url: &str| {
        let q = query(url);
        *fake.state.challenge.lock().unwrap() = q.get("code_challenge").cloned();
        assert_eq!(q.get("code_challenge_method").map(String::as_str), Some("S256"));
        assert_eq!(q.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(q.get("client_id").map(String::as_str), Some("mi-cliente"));
        assert_eq!(q.get("scope").map(String::as_str), Some("mail offline_access"));
        assert_eq!(q.get("login_hint").map(String::as_str), Some("ana@ejemplo.es"));
        assert!(q.get("state").map_or(false, |s| s.len() >= 20));
        let redirect = q.get("redirect_uri").cloned().unwrap();
        assert!(redirect.starts_with("http://127.0.0.1:") || redirect.starts_with("http://localhost:"), "{redirect}");
        let port: u16 = redirect.trim_start_matches("http://127.0.0.1:").trim_start_matches("http://localhost:").trim_end_matches('/').parse().unwrap();
        let path = answer(&q);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            let _ = http_get(&path, port, "localhost");
        });
        Ok(())
    }
}

#[test]
fn oauth_login_exchanges_the_code_with_pkce_stores_only_the_refresh_token_and_renews() {
    let fake = FakeOAuth::start("mi-cliente", "CODIGO-1", "REFRESCO-1");
    let a = oauth_account(&fake.token_url(), "https://id.ejemplo.es/auth");
    let secrets = MemorySecrets::default();
    let open = browser(&fake, |q| format!("/?code=CODIGO-1&state={}", q["state"]));
    auth::login(&a, None, &secrets, &open, Duration::from_secs(10)).unwrap();
    assert!(auth::logged_in_with(&a));
    use super::store::Secrets;
    assert_eq!(secrets.get("t1#oauth").unwrap().as_deref(), Some("REFRESCO-1"));
    assert_eq!(secrets.get("t1").unwrap(), None, "no hay contraseña");
    // el token de acceso viene de la memoria mientras no caduca: sin nuevas peticiones
    let n = fake.state.requests.lock().unwrap().len();
    let t1 = auth::access_token(&a, &secrets).unwrap();
    assert!(t1.starts_with("AT"));
    assert_eq!(fake.state.requests.lock().unwrap().len(), n);
    let reqs = fake.state.requests.lock().unwrap().join("\n");
    assert!(reqs.contains("code_verifier="), "se envió el verificador de PKCE");
    assert!(!reqs.contains("client_secret"));
    // olvidar borra todo y obliga a iniciar sesión de nuevo
    auth::forget("t1", &secrets).unwrap();
    assert!(!auth::logged_in_with(&a));
    assert!(auth::access_token(&a, &secrets).unwrap_err().contains("iniciar sesión"));
}

#[test]
fn oauth_refreshes_with_the_stored_token_and_explains_a_revoked_session() {
    let fake = FakeOAuth::start("mi-cliente", "C", "R1");
    let a = oauth_account(&fake.token_url(), "https://id.ejemplo.es/auth");
    let secrets = MemorySecrets::default();
    use super::store::Secrets;
    auth::forget("t1", &secrets).unwrap();
    secrets.set("t1#oauth", "R1").unwrap();
    let t = auth::access_token(&a, &secrets).unwrap();
    assert!(t.starts_with("AT"));
    assert!(fake.state.requests.lock().unwrap().iter().any(|r| r.contains("grant_type=refresh_token") && r.contains("scope=")), "Microsoft y otros piden el ámbito al renovar");
    auth::forget("t1", &secrets).unwrap();
    secrets.set("t1#oauth", "REVOCADO").unwrap();
    let e = auth::access_token(&a, &secrets).unwrap_err();
    assert!(e.contains("caducó o fue revocada"), "{e}");
}

#[test]
fn oauth_ignores_requests_with_the_wrong_state_and_reports_a_refusal() {
    let fake = FakeOAuth::start("mi-cliente", "CODIGO-1", "R");
    let a = oauth_account(&fake.token_url(), "https://id.ejemplo.es/auth");
    let secrets = MemorySecrets::default();
    // un código con otro «state» (alguien intenta colar el suyo) no vale: se acaba por tiempo
    let open = browser(&fake, |_| "/?code=CODIGO-1&state=otro".to_string());
    let e = auth::login(&a, None, &secrets, &open, Duration::from_millis(700)).unwrap_err();
    assert!(e.contains("tiempo de espera"), "{e}");
    assert!(!auth::logged_in_with(&a));
    // el usuario rechaza el permiso
    let open = browser(&fake, |q| format!("/?error=access_denied&state={}", q["state"]));
    assert_eq!(auth::login(&a, None, &secrets, &open, Duration::from_secs(5)).unwrap_err(), "Se canceló el inicio de sesión.");
    // un código falso lo rechaza el proveedor
    let open = browser(&fake, |q| format!("/?code=FALSO&state={}", q["state"]));
    let e = auth::login(&a, None, &secrets, &open, Duration::from_secs(5)).unwrap_err();
    assert!(e.contains("caducó o fue revocada") || e.contains("rechaz"), "{e}");
    use super::store::Secrets;
    assert_eq!(secrets.get("t1#oauth").unwrap(), None);
}

#[test]
fn oauth_needs_a_known_client_and_never_opens_a_plain_http_authorization_page() {
    let fake = FakeOAuth::start("otro-cliente", "C", "R");
    let a = oauth_account(&fake.token_url(), "https://id.ejemplo.es/auth");
    let secrets = MemorySecrets::default();
    let open = browser(&fake, |q| format!("/?code=C&state={}", q["state"]));
    let e = auth::login(&a, None, &secrets, &open, Duration::from_secs(5)).unwrap_err();
    assert!(e.contains("identificador de cliente"), "{e}");
    let http = oauth_account(&fake.token_url(), "http://id.ejemplo.es/auth");
    assert!(auth::login(&http, None, &secrets, &|_| panic!("no se debe abrir"), Duration::from_secs(1)).unwrap_err().contains("sin cifrar"));
    assert!(auth::open_browser("http://evil.example/x").is_err());
    assert!(auth::open_browser("file:///c:/windows/system32/calc.exe").is_err());
}

#[test]
fn provider_presets_use_the_right_scopes() {
    let mut a = account(1, 1);
    a.auth = Auth { kind: AuthKind::Oauth, oauth: Some(OAuth { provider: "microsoft".into(), client_id: "x".into(), tenant: Some("consumers".into()), ..Default::default() }) };
    let e = auth::endpoints(&a).unwrap();
    assert!(e.auth_url.contains("/consumers/oauth2/v2.0/authorize"));
    assert!(e.scope.contains("IMAP.AccessAsUser.All") && e.scope.contains("SMTP.Send") && e.scope.contains("offline_access"));
    assert_eq!(e.redirect_host, "localhost");
    a.protocol = Protocol::Ews;
    assert!(auth::endpoints(&a).unwrap().scope.contains("EWS.AccessAsUser.All"));
    a.protocol = Protocol::Jmap;
    assert!(auth::endpoints(&a).is_err());
    let mut g = account(1, 1);
    g.auth = Auth { kind: AuthKind::Oauth, oauth: Some(OAuth { provider: "google".into(), client_id: "x.apps.googleusercontent.com".into(), ..Default::default() }) };
    let e = auth::endpoints(&g).unwrap();
    assert_eq!(e.scope, "https://mail.google.com/");
    assert!(e.extra.contains(&("access_type", "offline")));
    assert_eq!(e.redirect_host, "127.0.0.1");
}

#[test]
fn an_oauth_account_cannot_be_saved_without_logging_in_first() {
    use super::store::tests::{temp_dir, MemorySecrets};
    use super::store::Accounts;
    let fake = FakeOAuth::start("mi-cliente", "C1", "R1");
    let mut a = oauth_account(&fake.token_url(), "https://id.ejemplo.es/auth");
    a.id = "guardar-1".into();
    let dir = temp_dir("oauth-save");
    let store = Accounts::new(&dir);
    let secrets = MemorySecrets::default();
    assert!(store.save(a.clone(), None, &secrets).unwrap_err().contains("Inicia sesión"));
    assert!(store.save(a.clone(), Some("clave"), &secrets).is_err(), "con OAuth no hay contraseña");
    let open = browser(&fake, |q| format!("/?code=C1&state={}", q["state"]));
    auth::login(&a, None, &secrets, &open, Duration::from_secs(10)).unwrap();
    store.save(a.clone(), None, &secrets).unwrap();
    // cambiar el proveedor exige iniciar sesión otra vez
    let mut b = a.clone();
    b.auth.oauth.as_mut().unwrap().client_id = "otro".into();
    assert!(store.save(b, None, &secrets).unwrap_err().contains("Inicia sesión"));
    // quitar la cuenta olvida los tokens
    store.remove("guardar-1", &secrets).unwrap();
    use super::store::Secrets;
    assert_eq!(secrets.get("guardar-1#oauth").unwrap(), None);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- estas usan internet; se ejecutan a mano con `cargo test -- --ignored`
// Comprueban que el cifrado funciona y que el certificado se valida, sin usar ninguna cuenta.

fn public(host: &str, port: u16, security: Security) -> Account {
    let s = Server { host: host.into(), port, security };
    Account { id: "pub".into(), name: "".into(), email: "nadie@ejemplo.es".into(), username: "nadie@ejemplo.es".into(), imap: s.clone(), smtp: s, protocol: Protocol::Imap, auth: Auth::default(), url: None, save_sent: None }
}

#[test]
#[ignore]
fn tls_real_servers_complete_the_handshake_and_reject_the_fake_login() {
    let e = Imap::connect(&public("imap.gmail.com", 993, Security::Tls), &pw("clave-falsa")).err().unwrap();
    assert!(e.contains("contraseña de aplicación"), "se esperaba llegar al inicio de sesión: {e}");
    let e = Imap::connect(&public("imap.gmail.com", 143, Security::StartTls), &pw("clave-falsa")).err().unwrap();
    assert!(e.contains("contraseña de aplicación") || e.contains("rechaz"), "{e}");
    let e = smtp_client::test(&public("smtp.gmail.com", 465, Security::Tls), &pw("clave-falsa")).unwrap_err();
    assert!(e.contains("contraseña de aplicación"), "{e}");
    let e = smtp_client::test(&public("smtp.gmail.com", 587, Security::StartTls), &pw("clave-falsa")).unwrap_err();
    assert!(e.contains("contraseña de aplicación"), "{e}");
}

#[test]
#[ignore]
fn tls_accepts_a_valid_certificate() {
    let e = Imap::connect(&public("badssl.com", 443, Security::Tls), &pw("x")).err().unwrap();
    assert!(!e.contains("conexión segura"), "el certificado válido no debe rechazarse: {e}");
    let e = smtp_client::test(&public("badssl.com", 443, Security::Tls), &pw("x")).unwrap_err();
    assert!(!e.contains("conexión segura"), "el certificado válido no debe rechazarse: {e}");
}

#[test]
#[ignore]
fn tls_refuses_bad_certificates() {
    for host in ["expired.badssl.com", "wrong.host.badssl.com", "self-signed.badssl.com", "untrusted-root.badssl.com"] {
        let e = Imap::connect(&public(host, 443, Security::Tls), &pw("x")).err().unwrap();
        assert!(e.contains("conexión segura"), "{host}: {e}");
        let e = smtp_client::test(&public(host, 443, Security::Tls), &pw("x")).unwrap_err();
        assert!(e.contains("conexión segura") || e.contains("TLS"), "{host}: {e}");
        let e = connect(&web_account(Protocol::Jmap, &format!("https://{host}/")), &pw("x")).err().unwrap();
        assert!(e.contains("conexión segura"), "{host}: {e}");
    }
}
