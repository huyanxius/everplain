import './extension-install-guide.css'

export function ExtensionInstallGuide({ id = 'clipper-install-guide', onClose }: { id?: string; onClose(): void }) {
  return <section id={id} className="ep-import__extension-guide" aria-labelledby={`${id}-title`}>
        <header><h2 id={`${id}-title`} className="qx-heading">安装 Everplain 收藏助手</h2><button type="button" className="qx-btn qx-btn--ghost" onClick={onClose}>收起教程</button></header>
        <p className="qx-meta">适用于电脑上的 Chrome / Edge，尚未上架扩展商店。准备工具会下载并校验扩展、整理到固定文件夹，再打开扩展管理页。</p>
        <ol className="ep-import__extension-steps">
          <li><h3>下载并运行准备工具</h3><p>点击“下载扩展”，选择 macOS 或 Windows。全部解压后，Mac 双击 <code>everplain-clipper-macos.command</code>；Windows 双击 <code>everplain-clipper-windows.cmd</code>，保留同目录的 <code>.ps1</code> 文件。按提示选择 Chrome 或 Edge。</p></li>
          <li><h3>加载扩展</h3><p>在打开的扩展管理页启用“开发者模式”，点击“加载已解压的扩展程序”，选择脚本打开的固定文件夹。安装后请保留这个文件夹。</p></li>
          <li><h3>登录后开始收藏</h3><p>在同一个浏览器用户资料中打开 <a href="https://e.qunxue.xyz" target="_blank" rel="noreferrer">e.qunxue.xyz</a> 并登录，保留标签页。收藏助手已预填此地址；回到要保存的网页，打开助手，点击“收藏当前页面”。</p></li>
        </ol>
        <details className="ep-import__extension-details">
          <summary>手动安装、权限与常见问题</summary>
          <div>
            <h3>手动安装</h3>
            <p>系统若拦截脚本，请改用 <a href="/downloads/everplain-clipper.zip" download>手动下载 ZIP</a>，不要关闭系统保护或绕过管理限制。Mac 双击解压；Windows 右键选择“全部解压缩”。把文件夹放在固定位置，在扩展管理页加载直接包含 <code>manifest.json</code> 的那一层，不要选择 ZIP 或上一级文件夹。</p>
            <h3>首次收藏与权限</h3>
            <p>首次收藏时，确认浏览器请求的站点是 <code>https://e.qunxue.xyz</code>，再允许访问。若使用其他 Everplain 站点，请修改助手中的地址，并在同一浏览器用户资料登录该站点。地址使用 HTTPS，本机开发才可使用 localhost 或 127.0.0.1 的 HTTP 地址。</p>
            <p>收藏时读取当前网页的标题、网址和正文，提交到你的 Everplain；扩展在本机保存站点地址，不保存密码、Cookie 或访问令牌。扩展复用这个浏览器里的登录状态，没有单独的登录或配对按钮，无需填写密码、Cookie、令牌或配对码。</p>
            <p>只有点击“导入全部书签”才申请书签权限，并提交此浏览器用户资料中的全部 HTTP(S) 书签。只收藏网页无需开启书签权限，也无需允许所有网站、无痕模式或本地文件访问。</p>
            <h3>确认收藏成功</h3>
            <p>助手显示“已收藏”后，在本页“导入记录”点击“刷新”，打开资料库核对条目。书签显示“已提交”不代表全部入库；在导入记录查看进度，失败条目可查看原因并单独重试。</p>
            <dl className="ep-import__extension-help">
              <div><dt>下载失败，或文件不是 ZIP</dt><dd>请刷新本页重新下载，不要把网页另存为安装包。工具下载或校验失败时可稍后重试，或使用上方手动 ZIP；仍失败请联系站点维护者。</dd></div>
              <div><dt>提示缺少或无法读取 manifest.json</dt><dd>先完整解压，再选择直接包含 manifest.json 的文件夹。如果文件不存在，重新从本页下载。</dd></div>
              <div><dt>扩展管理页没有自动打开</dt><dd>在 Chrome 地址栏输入 <code>chrome://extensions</code>，Edge 则输入 <code>edge://extensions</code>。打开开发者模式后加载脚本打开的固定文件夹。</dd></div>
              <div><dt>没有“加载已解压的扩展程序”</dt><dd>确认使用电脑上的 Chrome / Edge 并已打开开发者模式。若浏览器由公司或学校管理且禁止安装，请联系管理员，不要绕过限制。</dd></div>
              <div><dt>提示先登录，或 Everplain 页面还没打开</dt><dd>检查助手中的站点地址，与已登录页面保持一致；用同一浏览器用户资料重新登录并等待页面打开，再回原网页重试。无需导出 Cookie 或令牌。</dd></div>
              <div><dt>权限被拒绝，或目标页面已切换</dt><dd>重新打开收藏助手并点击收藏，核对后允许目标 Everplain 站点的请求；保持 Everplain 标签页在该站点。如果不想授权，可直接在本页导入文件。</dd></div>
              <div><dt>无法读取当前网页或没有正文</dt><dd>请在普通 HTTP(S) 文章页操作；浏览器设置页、扩展商店等受保护页面不能收藏。等待原网页加载完成再试；页面过大时改用本页上传整理好的文件。</dd></div>
            </dl>
            <p className="qx-meta">更新：重新运行准备工具，在扩展管理页移除旧版本，再加载这次打开的文件夹；手动安装也可将新 ZIP 解压并替换原文件夹后点击重新加载。停用或卸载在扩展管理页操作。<a href="https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world?hl=zh-cn" target="_blank" rel="noreferrer">查看 Chrome 官方加载说明</a></p>
          </div>
        </details>
      </section>
}
