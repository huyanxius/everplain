# Native Markdown parser

Swift Markdown and Swift cmark 0.5.0 are the Swift project's official source
libraries. Only library sources and licenses are included. The local package
manifests remove documentation plugins, command tools and upstream test targets;
they use relative dependencies so app builds need no package download.

`provenance.json` records the official release archive URLs and exact SHA256s.
Each package retains its original manifest as `UPSTREAM-Package.swift.txt` and
its upstream license. The app renders parsed content with SwiftUI and AppKit;
this dependency does not add a browser or a WebView.
