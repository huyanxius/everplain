# Android / Web visual correspondence

Reference: verified latest live `welcome-live-ready` frontend plus the shared
`contracts/WEB_PARITY.md` actual cloud-browser audit (2026-10-04).
This audit records actual component structure; matching tokens alone is not a
visual acceptance claim. Android screenshots use synthetic data exclusively.

## Home

| Web source | Native correspondence |
|---|---|
| `AppHomePage`, `.hm-desk` at <=640px | 24dp vertical / 16dp horizontal inset |
| `.hm-me` | Original 72dp Bot, 16dp element gaps |
| `.hm-hello` | Source greeting pool/day selection; serif 36sp, 1.15 line height, 8dp top gap |
| `.hm-sub` | 16sp, 1.7 line height, muted ink, 16dp bottom gap |
| `HomeComposer` / shared `ConversationComposer` | Same native editor instance persists into Chat; source two-row mobile geometry |
| Library/research cards and library prompt chips | Scope expanded; pending real module/data wiring. Do not treat the current sparse Home as final parity. |
| Subtitle / tool availability | Pending full library/import/research restoration under the expanded scope. |

## Chat: empty, active and interrupted

| Web source | Native correspondence |
|---|---|
| `AgentModeSwitch` / `PersonalCompanion` | Original 32dp Bot inside selected pill; no visible Chat/对话 text; research tab integration remains pending under expanded scope |
| Mobile context header | 56dp safe-area-aware header, records and more-actions affordances; Web-search and research-panel popup integration remains pending |
| `ConversationLayout` mobile empty body | Centered source greeting/composer block; 32dp bottom allowance |
| `.cv-layout__greeting` | 96dp original Bot, 16dp gap/padding, 28sp serif title using display line-height |
| `.cv-layout__compose` mobile | 12dp horizontal inset; 8dp top / 12dp bottom |
| `ConversationThread`, `.cv-thread` | 16dp mobile horizontal, 24dp top / 32dp bottom, 32dp turn spacing |
| `.cv-turn__question .qx-bubble` | No user role heading. Right aligned, max 80%, neutral strong surface, 24dp radius, 12/20dp padding |
| `.cv-turn__answer` | No Agent-name heading. Independent 32dp avatar column plus 16dp gap |
| `PersonalCompanion` answer states | Same selected avatar/color; think before text, work while answering, idle after completion |
| `.qx-prose`, `AgentAnswerMarkdown` | Android-native CommonMark/GFM spans; serif 17sp/1.85; source heading sizes and paragraph metrics; no WebView |
| `ConversationThinking` | Real status precedes the paced answer; native character entry/exit, 1.333s source shimmer, 420ms collapse; no invented timed status sequence |
| `TurnActions` | Copy and regenerate are source icon actions after streaming, with 1.6-second copied feedback; regenerate starts an explicit new turn and does not replay a cancelled pending turn |
| Citations | Numbered source-style reference chips; full library/research evidence panels remain pending under expanded scope |
| Unknown-stop recovery | Explicit native safety controls for read-only recheck / resume / stop / ending local waiting; not silently substituted for confirmed server cancellation |

## Composer and model controls

| Web source | Native correspondence |
|---|---|
| `.conversation-composer` | Neutral source surface, 28dp mobile panel radius, 10dp padding and 12dp left inset |
| Text area | Native multiline editor, 16sp, 26sp baseline line height, 36dp minimum row, 8dp inter-row gap |
| Add / send / stop | Original Phosphor regular geometry; 36dp visible circular controls; accessible native touch handling |
| Disabled/in-flight behavior | Mutations rejected without deactivating the native input session; repeated sends are blocked |
| Model summary | Server label plus supported effort and small caret; source 44vw / 260dp width bound with truncation |
| Model popup | Neutral 20dp-corner popup, live model list and selected check, no bundled production model catalog |
| `EffortSlider` | Discrete 6dp rail, 4dp ticks, 22dp thumb, current label, stepped accessible control and source hint copy |
| Unknown model / network error | Explicit unavailable/retry state rather than invented model fallback |

## Account and Agent settings

| Web source | Native correspondence |
|---|---|
| `AccountSettingsPage` mobile category picker | Source neutral capsule input, 48dp baseline, 20dp horizontal padding |
| `ProfilePanel` | Label/control hierarchy, compact name/email rows, secondary Edit pill, 1:1.5 metadata columns |
| Account date | Local-time `yyyy/MM/dd HH:mm`, including year, rather than a newly invented date style |
| Usage buckets | Separate settled remaining balances, two decimals, expired buckets excluded; unlimited/unavailable are distinct |
| `AgentSettingsPanel` mobile visuals | Original geometry, 64dp preview, 12dp preview/chooser gap; four 44dp options per row |
| Avatar/color grids | Source four-column 4dp spacing; 8dp separation between the grids; 24dp color swatches and selected ring |
| Name field | Gray 48dp capsule, 40-character schema/UI bound, neutral focus ring |
| Speaking style | Two columns, source four Chinese labels, centered 14sp/550 text and selected surface pill |
| `AgentSoulEditor` | Monospace, seven lines, >=180dp, 8000-character bound, source helper/cancel/conflict copy |
| Save | Source end-aligned primary pill; scrollable and reachable with the IME present |
| Navigation and CAS | Drafts retained per authenticated owner; 409 shows latest profile but does not silently discard the draft |

## Assets and platform distinctions

- Avatar paths/colors/decorations are the shared canonical Web assets. Native
  motion consumes the source states and honors Android reduced-motion settings.
- Glyphs are generated from the shared canonical archive: actual Web NavIcon
  24px / 1.75-stroke geometry for navigation, separate Phosphor **2.1.10** regular
  256px filled geometry for composer/model/actions. Source hashes are recorded.
  Material look-alikes are not used.
- Material color/elevation slots are explicitly neutral; generic Material ripple
  decoration is disabled. Platform selection, keyboard, insets, TalkBack and Back
  remain native behaviors.
- Web proprietary font fallback stacks are not bundled. Android uses its own
  serif/sans/monospace faces. Font rasterization and native shadow kernels cannot
  be called pixel-identical to a Mac browser from source comparison alone.
- Native motion ports now include 120-radius Liquid with original decorations,
  delayed seven-avatar login crowd, source state keyframes, 48ms display-only
  pacing, AST/UTF-16-based 1100ms color reveal, real-status kinetic copy, and a
  940ms decorative send flight using shared sampled curves. The real bubble stays
  in accessibility/layout; navigation, resized viewport, Stop and reduced motion
  cancel the overlay. Composer height settles over 320ms.
- Completion keeps the turn's visual key so the final authoritative response does
  not remount and skip its remaining paced characters. Recovery/history never
  trigger the submit-only flight. These are implemented/compiled, not a claim of
  browser-engine pixel equivalence or a passing final device animation review.

## Login

The source email-first login and registration code/password flows now use native
controls and generated real contracts. Seven canonical avatars share the source
stagger. Password visibility, local validation, Back, busy/error states and a
separate advanced origin setting are implemented. No real verification email,
new production account or password transmission was used in QA.

## Evidence and boundaries

The pre-glyph-finalization candidate passed all three actual Android device test
classes, including real IME, new Home send, Agent editor/Save, Stop recovery,
late-response isolation, CAS/401, form retention and native Markdown spans.
The original role-heading discrepancy reported by the user was real and has
been removed according to `ConversationThread.tsx`.

The frozen authentication/motion revision passed four real Android test classes
on 2026-10-04 after warm package compilation. Its record includes 19 core tests,
APK/test APK assembly, and lint 0 errors (11 non-blocking warnings). The new module
source work is not included in that frozen APK. The repository verification
record is authoritative for its eventual result. There is no claim of live
account/model validation, nor of a same-viewport pixel diff against a rendered
Web page when that reference render has not been obtained.
