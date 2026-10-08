"""Low-memory supplemental JVM check of the exact pure controller sources; no Android UI claim.
Requires the already-built :core:jar and Gradle's official Maven dependency cache.
Normal CI still runs these same tests via :app:testDebugUnitTest.
"""
import argparse, os, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,required=True);p.add_argument('--java',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1]
def jar(group,name,version):
 paths=list((a.cache/'caches/modules-2/files-2.1'/group/name/version).glob('*/*.jar'))
 if len(paths)!=1:raise RuntimeError(f'Missing or ambiguous cached official dependency: {group}:{name}:{version}')
 return str(paths[0])
stdlib=jar('org.jetbrains.kotlin','kotlin-stdlib','2.1.20')
coroutines=jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.10.2')
annotations=jar('org.jetbrains','annotations','23.0.0')
compiler=[jar('org.jetbrains.kotlin','kotlin-compiler-embeddable','2.1.20'),stdlib,coroutines,annotations,jar('org.jetbrains.kotlin','kotlin-script-runtime','2.1.20'),jar('org.jetbrains.kotlin','kotlin-reflect','1.6.10'),jar('org.jetbrains.intellij.deps','trove4j','1.0.20200330')]
cp=[str(root/'core/build/libs/core.jar'),stdlib,coroutines,annotations,
 jar('org.jetbrains.kotlinx','kotlinx-serialization-json-jvm','1.8.1'),jar('org.jetbrains.kotlinx','kotlinx-serialization-core-jvm','1.8.1'),
 jar('org.jetbrains.kotlinx','kotlinx-coroutines-test-jvm','1.10.2'),jar('org.jetbrains.kotlin','kotlin-test','2.1.20'),jar('org.jetbrains.kotlin','kotlin-test-junit','2.1.20'),jar('junit','junit','4.13.2'),jar('org.hamcrest','hamcrest-core','1.3'),jar('com.squareup.okhttp3','okhttp','4.12.0'),jar('com.squareup.okhttp3','mockwebserver','4.12.0'),jar('com.squareup.okio','okio-jvm','3.6.0')]
sources=[root/f'app/src/main/java/app/everplain/android/{name}.kt' for name in ('AccountSettingsController','ChannelController','MethodPlanController','ResearchArchiveController','ResearchAnalysisController','ResearchDocumentController')]+[root/f'app/src/test/java/app/everplain/android/{name}Test.kt' for name in ('AccountSettingsController','ChannelController','MethodPlanController','ResearchArchiveController','ResearchAnalysisController','ResearchDocumentController')]
sources += [root/'app/src/main/java/app/everplain/android/AgentSettingsDraft.kt',root/'app/src/test/java/app/everplain/android/AgentSettingsDraftTest.kt',root/'app/src/main/java/app/everplain/android/TheoryController.kt',root/'app/src/test/java/app/everplain/android/TheoryControllerTest.kt',root/'core/src/main/kotlin/app/everplain/core/EverplainApi.kt',root/'core/src/main/kotlin/app/everplain/core/NativeFileTransport.kt',root/'core/src/main/kotlin/app/everplain/core/ResearchArchiveDownload.kt',root/'core/src/test/kotlin/app/everplain/core/ResearchArchiveDownloadTest.kt',root/'core/src/test/kotlin/app/everplain/core/BoundedJsonTest.kt',root/'core/src/test/kotlin/app/everplain/core/FileTransportTest.kt']
a.output.mkdir(parents=True,exist_ok=True)
subprocess.run([a.java,'-Xmx384m','-cp',os.pathsep.join(compiler),'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-Xplugin='+jar('org.jetbrains.kotlin','kotlin-serialization-compiler-plugin-embeddable','2.1.20'),'-no-stdlib','-no-reflect','-jvm-target','17','-classpath',os.pathsep.join(cp),'-d',str(a.output),*map(str,sources)],check=True)
subprocess.run([a.java,'-Xmx192m','-cp',os.pathsep.join([str(a.output),*cp]),'org.junit.runner.JUnitCore','app.everplain.android.AccountSettingsControllerTest','app.everplain.android.ChannelControllerTest','app.everplain.android.MethodPlanControllerTest','app.everplain.android.ResearchArchiveControllerTest','app.everplain.android.ResearchAnalysisControllerTest','app.everplain.android.ResearchDocumentControllerTest','app.everplain.android.TheoryControllerTest','app.everplain.android.AgentSettingsDraftTest','app.everplain.core.ResearchArchiveDownloadTest','app.everplain.core.BoundedJsonTest','app.everplain.core.FileTransportTest'],check=True,cwd=root/'app')
