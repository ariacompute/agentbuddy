//! Shell copy for the update card on the about page and the update toast.
//!
//! Kept in its own table so the long-standing connection/tray table in
//! `copy.rs` stays untouched. `i18n::translate` and `i18n::block_for` look in
//! both, so the about page gets one flat `t(key)` namespace and the same
//! English-fallback rules apply. Every language must translate every key;
//! the tests here enforce it just as `copy.rs` does.

pub const EN: &[(&str, &str)] = &[
    ("aboutUpgrade", "Updates"),
    ("upgradeCheck", "Check for updates"),
    ("upgradeUpgrade", "Upgrade now"),
    ("upgradeDownload", "Manual download"),
    ("upgradeSource", "Source"),
    ("upgradeChecking", "Checking…"),
    ("upgradeUpToDate", "You are up to date."),
    ("upgradeAvailable", "Version {v} is available."),
    ("upgradeUnsupported", "No installer for this system."),
    ("upgradeBusy", "Installing…"),
    ("upgradeFailed", "Update unavailable."),
    ("upgradeNotifyTitle", "agentbuddy update"),
    ("upgradeNotifyBody", "Version {v} is available. Open settings to upgrade."),
];

pub const ZH: &[(&str, &str)] = &[
    ("aboutUpgrade", "更新"),
    ("upgradeCheck", "检查更新"),
    ("upgradeUpgrade", "立即升级"),
    ("upgradeDownload", "手动下载"),
    ("upgradeSource", "来源"),
    ("upgradeChecking", "正在检查…"),
    ("upgradeUpToDate", "已是最新版本。"),
    ("upgradeAvailable", "新版本 {v} 可用。"),
    ("upgradeUnsupported", "当前系统暂无安装包。"),
    ("upgradeBusy", "正在安装…"),
    ("upgradeFailed", "更新暂不可用。"),
    ("upgradeNotifyTitle", "agentbuddy 更新"),
    ("upgradeNotifyBody", "新版本 {v} 已发布，打开设置即可升级。"),
];

pub const ZH_TW: &[(&str, &str)] = &[
    ("aboutUpgrade", "更新"),
    ("upgradeCheck", "檢查更新"),
    ("upgradeUpgrade", "立即升級"),
    ("upgradeDownload", "手動下載"),
    ("upgradeSource", "來源"),
    ("upgradeChecking", "正在檢查…"),
    ("upgradeUpToDate", "已是最新版本。"),
    ("upgradeAvailable", "新版本 {v} 已推出。"),
    ("upgradeUnsupported", "此系統尚無安裝包。"),
    ("upgradeBusy", "正在安裝…"),
    ("upgradeFailed", "目前無法更新。"),
    ("upgradeNotifyTitle", "agentbuddy 更新"),
    ("upgradeNotifyBody", "新版本 {v} 已推出，開啟設定即可升級。"),
];

pub const ES: &[(&str, &str)] = &[
    ("aboutUpgrade", "Actualizaciones"),
    ("upgradeCheck", "Buscar actualizaciones"),
    ("upgradeUpgrade", "Actualizar ahora"),
    ("upgradeDownload", "Descarga manual"),
    ("upgradeSource", "Origen"),
    ("upgradeChecking", "Comprobando…"),
    ("upgradeUpToDate", "Ya tienes la última versión."),
    ("upgradeAvailable", "La versión {v} está disponible."),
    ("upgradeUnsupported", "No hay instalador para este sistema."),
    ("upgradeBusy", "Instalando…"),
    ("upgradeFailed", "Actualización no disponible."),
    ("upgradeNotifyTitle", "Actualización de agentbuddy"),
    ("upgradeNotifyBody", "La versión {v} está lista. Abre Ajustes para actualizar."),
];

pub const FR: &[(&str, &str)] = &[
    ("aboutUpgrade", "Mises à jour"),
    ("upgradeCheck", "Vérifier les mises à jour"),
    ("upgradeUpgrade", "Mettre à jour"),
    ("upgradeDownload", "Téléchargement manuel"),
    ("upgradeSource", "Provenance"),
    ("upgradeChecking", "Vérification…"),
    ("upgradeUpToDate", "Vous êtes à jour."),
    ("upgradeAvailable", "La version {v} est disponible."),
    ("upgradeUnsupported", "Aucun programme d'installation pour ce système."),
    ("upgradeBusy", "Installation…"),
    ("upgradeFailed", "Mise à jour indisponible."),
    ("upgradeNotifyTitle", "Mise à jour d'agentbuddy"),
    ("upgradeNotifyBody", "La version {v} est prête. Ouvrez les paramètres pour mettre à jour."),
];

pub const DE: &[(&str, &str)] = &[
    ("aboutUpgrade", "Aktualisierungen"),
    ("upgradeCheck", "Nach Updates suchen"),
    ("upgradeUpgrade", "Jetzt aktualisieren"),
    ("upgradeDownload", "Manueller Download"),
    ("upgradeSource", "Quelle"),
    ("upgradeChecking", "Wird geprüft…"),
    ("upgradeUpToDate", "Sie sind auf dem neuesten Stand."),
    ("upgradeAvailable", "Version {v} ist verfügbar."),
    ("upgradeUnsupported", "Für dieses System gibt es kein Installationspaket."),
    ("upgradeBusy", "Wird installiert…"),
    ("upgradeFailed", "Update nicht verfügbar."),
    ("upgradeNotifyTitle", "agentbuddy-Update"),
    ("upgradeNotifyBody", "Version {v} ist bereit. Öffnen Sie die Einstellungen zum Aktualisieren."),
];

pub const IT: &[(&str, &str)] = &[
    ("aboutUpgrade", "Aggiornamenti"),
    ("upgradeCheck", "Controlla aggiornamenti"),
    ("upgradeUpgrade", "Aggiorna ora"),
    ("upgradeDownload", "Download manuale"),
    ("upgradeSource", "Fonte"),
    ("upgradeChecking", "Controllo…"),
    ("upgradeUpToDate", "Sei aggiornato."),
    ("upgradeAvailable", "La versione {v} è disponibile."),
    ("upgradeUnsupported", "Nessun programma di installazione per questo sistema."),
    ("upgradeBusy", "Installazione…"),
    ("upgradeFailed", "Aggiornamento non disponibile."),
    ("upgradeNotifyTitle", "Aggiornamento di agentbuddy"),
    ("upgradeNotifyBody", "La versione {v} è pronta. Apri le impostazioni per aggiornare."),
];

pub const RU: &[(&str, &str)] = &[
    ("aboutUpgrade", "Обновления"),
    ("upgradeCheck", "Проверить обновления"),
    ("upgradeUpgrade", "Обновить сейчас"),
    ("upgradeDownload", "Скачать вручную"),
    ("upgradeSource", "Источник"),
    ("upgradeChecking", "Проверка…"),
    ("upgradeUpToDate", "У вас последняя версия."),
    ("upgradeAvailable", "Доступна версия {v}."),
    ("upgradeUnsupported", "Для этой системы нет установочного пакета."),
    ("upgradeBusy", "Установка…"),
    ("upgradeFailed", "Обновление недоступно."),
    ("upgradeNotifyTitle", "Обновление agentbuddy"),
    ("upgradeNotifyBody", "Готова версия {v}. Откройте настройки для обновления."),
];

pub const JA: &[(&str, &str)] = &[
    ("aboutUpgrade", "アップデート"),
    ("upgradeCheck", "更新を確認"),
    ("upgradeUpgrade", "今すぐアップデート"),
    ("upgradeDownload", "手動ダウンロード"),
    ("upgradeSource", "取得元"),
    ("upgradeChecking", "確認中…"),
    ("upgradeUpToDate", "最新バージョンです。"),
    ("upgradeAvailable", "バージョン {v} が利用できます。"),
    ("upgradeUnsupported", "このシステム用のインストーラーはありません。"),
    ("upgradeBusy", "インストール中…"),
    ("upgradeFailed", "更新を利用できません。"),
    ("upgradeNotifyTitle", "agentbuddy の更新"),
    ("upgradeNotifyBody", "バージョン {v} が利用できます。設定を開いて更新してください。"),
];

pub const KO: &[(&str, &str)] = &[
    ("aboutUpgrade", "업데이트"),
    ("upgradeCheck", "업데이트 확인"),
    ("upgradeUpgrade", "지금 업그레이드"),
    ("upgradeDownload", "수동 다운로드"),
    ("upgradeSource", "출처"),
    ("upgradeChecking", "확인 중…"),
    ("upgradeUpToDate", "최신 버전입니다."),
    ("upgradeAvailable", "버전 {v}을 사용할 수 있습니다."),
    ("upgradeUnsupported", "이 시스템용 설치 프로그램이 없습니다."),
    ("upgradeBusy", "설치 중…"),
    ("upgradeFailed", "업데이트를 사용할 수 없습니다."),
    ("upgradeNotifyTitle", "agentbuddy 업데이트"),
    ("upgradeNotifyBody", "버전 {v}이 준비되었습니다. 설정에서 업그레이드하세요."),
];

pub const PT: &[(&str, &str)] = &[
    ("aboutUpgrade", "Atualizações"),
    ("upgradeCheck", "Verificar atualizações"),
    ("upgradeUpgrade", "Atualizar agora"),
    ("upgradeDownload", "Download manual"),
    ("upgradeSource", "Origem"),
    ("upgradeChecking", "A verificar…"),
    ("upgradeUpToDate", "Está atualizado."),
    ("upgradeAvailable", "A versão {v} está disponível."),
    ("upgradeUnsupported", "Não há instalador para este sistema."),
    ("upgradeBusy", "A instalar…"),
    ("upgradeFailed", "Atualização indisponível."),
    ("upgradeNotifyTitle", "Atualização do agentbuddy"),
    ("upgradeNotifyBody", "A versão {v} está pronta. Abra as definições para atualizar."),
];

pub const AR: &[(&str, &str)] = &[
    ("aboutUpgrade", "التحديثات"),
    ("upgradeCheck", "التحقق من التحديثات"),
    ("upgradeUpgrade", "الترقية الآن"),
    ("upgradeDownload", "تنزيل يدوي"),
    ("upgradeSource", "المصدر"),
    ("upgradeChecking", "جارٍ التحقق…"),
    ("upgradeUpToDate", "لديك أحدث إصدار."),
    ("upgradeAvailable", "الإصدار {v} متاح."),
    ("upgradeUnsupported", "لا توجد حزمة تثبيت لهذا النظام."),
    ("upgradeBusy", "جارٍ التثبيت…"),
    ("upgradeFailed", "التحديث غير متاح."),
    ("upgradeNotifyTitle", "تحديث agentbuddy"),
    ("upgradeNotifyBody", "الإصدار {v} جاهز. افتح الإعدادات للترقية."),
];

pub const HI: &[(&str, &str)] = &[
    ("aboutUpgrade", "अपडेट"),
    ("upgradeCheck", "अपडेट जाँचें"),
    ("upgradeUpgrade", "अभी अपग्रेड करें"),
    ("upgradeDownload", "मैन्युअल डाउनलोड"),
    ("upgradeSource", "स्रोत"),
    ("upgradeChecking", "जाँच हो रही है…"),
    ("upgradeUpToDate", "आप नवीनतम संस्करण पर हैं।"),
    ("upgradeAvailable", "संस्करण {v} उपलब्ध है।"),
    ("upgradeUnsupported", "इस सिस्टम के लिए इंस्टॉलर नहीं है।"),
    ("upgradeBusy", "इंस्टॉल हो रहा है…"),
    ("upgradeFailed", "अपडेट उपलब्ध नहीं है।"),
    ("upgradeNotifyTitle", "agentbuddy अपडेट"),
    ("upgradeNotifyBody", "संस्करण {v} तैयार है। अपग्रेड करने के लिए सेटिंग्स खोलें।"),
];

/// One language's update block; unknown codes resolve to English.
pub fn block(lang: &str) -> &'static [(&'static str, &'static str)] {
    match lang {
        "zh" => ZH,
        "zh-TW" => ZH_TW,
        "es" => ES,
        "fr" => FR,
        "de" => DE,
        "it" => IT,
        "ru" => RU,
        "ja" => JA,
        "ko" => KO,
        "pt" => PT,
        "ar" => AR,
        "hi" => HI,
        _ => EN,
    }
}

/// Every update key, in English order, chained after `copy::keys()`.
pub fn keys() -> impl Iterator<Item = &'static str> {
    EN.iter().map(|(key, _)| *key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    const CODES: [&str; 13] = [
        "en", "zh", "zh-TW", "es", "fr", "de", "it", "ru", "ja", "ko", "pt", "ar", "hi",
    ];

    #[test]
    fn every_language_carries_every_key_in_english_order() {
        for code in CODES {
            let block = block(code);
            assert_eq!(block.len(), EN.len(), "{code} has {} keys", block.len());
            for (index, ((en_key, en_value), (key, value))) in
                EN.iter().zip(block.iter()).enumerate()
            {
                assert_eq!(key, en_key, "{code} key #{index}");
                assert!(!value.trim().is_empty(), "{code}.{key} is empty");
                if code != "en" {
                    assert_ne!(value, en_value, "{code}.{key} merely repeats English");
                }
            }
        }
    }

    #[test]
    fn unknown_languages_read_english() {
        assert_eq!(block("nl"), EN);
        assert_eq!(block(""), EN);
        assert_eq!(block("ZH"), EN);
    }

    #[test]
    fn keys_are_unique_and_every_toast_mentions_the_version() {
        let mut seen = HashSet::new();
        for key in keys() {
            assert!(seen.insert(key), "{key} is declared twice");
            assert_eq!(key.trim(), key);
        }
        for code in CODES {
            let body = block(code)
                .iter()
                .find(|(key, _)| *key == "upgradeNotifyBody")
                .map(|(_, value)| *value)
                .unwrap();
            assert!(body.contains("{v}"), "{code} lost the version placeholder");
        }
    }
}
