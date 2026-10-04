/* Everplain adapter around unmodified citeproc 2.4.63. No browser/DOM or network APIs. */
function everplainFormatBibliography(inputJSON) {
    var input = JSON.parse(inputJSON);
    var items = input.items || [];
    if (!items.length) return JSON.stringify({htmlEntries: [], textEntries: [], hangingIndent: false, entrySpacing: 0, lineSpacing: 1});
    if (typeof input.style !== 'string' || input.style.indexOf('<style') < 0) throw new Error('CSL 样式文件无效。');
    var itemById = Object.create(null);
    items.forEach(function (item) { itemById[String(item.id)] = item; });
    var engine = new CSL.Engine({
        retrieveItem: function (id) { if (!Object.prototype.hasOwnProperty.call(itemById, id)) throw new Error('引用元数据不存在：' + id); return itemById[id]; },
        retrieveLocale: function () { return input.localeXML; }
    }, input.style, input.locale, true);
    engine.setOutputFormat('html');
    engine.updateItems(items.map(function (item) { return String(item.id); }));
    var html = engine.makeBibliography();
    engine.setOutputFormat('text');
    var plain = engine.makeBibliography();
    var params = html ? html[0] : {};
    return JSON.stringify({
        htmlEntries: html ? html[1] : [],
        textEntries: plain ? plain[1] : [],
        hangingIndent: Boolean(params.hangingindent),
        entrySpacing: Number(params.entryspacing || 0),
        lineSpacing: Number(params.linespacing || 1)
    });
}
