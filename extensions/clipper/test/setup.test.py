"""Bash preparation contract on Linux. No native macOS/browser success claimed."""
import hashlib
import pathlib
import stat
import subprocess
import tempfile
import unittest
import warnings
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'setup/everplain-clipper-macos.command'
FILES = ['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'capture.js', 'THIRD_PARTY_LICENSES.txt']

class SetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='Everplain 空格 space ')
        self.path = pathlib.Path(self.tmp.name)
        self.root = self.path / '固定目录 with spaces'
        self.root.mkdir()
        self.archive = self.path / '包 package.zip'
        self.checksum = self.path / 'checksums.sha256'
        self.content = {f: f'Content for {f}'.encode() for f in FILES}
        self.content['manifest.json'] = b'{"manifest_version":3,"name":"Everplain","version":"0.1.1"}'
    def tearDown(self):
        self.tmp.cleanup()
    def package(self, extra=None, omit=None, symlink=None, content=None):
        entries = dict(self.content if content is None else content)
        if omit: entries.pop(omit)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            with zipfile.ZipFile(self.archive, 'w', zipfile.ZIP_DEFLATED) as z:
                for name, data in entries.items():
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = (stat.S_IFLNK | 0o777 if symlink == name else stat.S_IFREG | 0o644) << 16
                    z.writestr(info, data)
                if extra: z.writestr(*extra)
        self.write_hashes()
    def write_hashes(self):
        data = {'everplain-clipper.zip': self.archive.read_bytes(), **self.content}
        self.checksum.write_text(''.join(f'{hashlib.sha256(value).hexdigest()}  {name}\n' for name,value in data.items()))
    def run_prepare(self):
        return subprocess.run(['bash', '-c', 'source "$1"; prepare_package "$2" "$3" "$4"; printf "%s" "${INSTALL_PATH-}"', 'setup-test', str(SCRIPT), str(self.archive), str(self.checksum), str(self.root)], capture_output=True, text=True)
    def test_valid_unicode_spaces_and_exact_files(self):
        self.package(); r = self.run_prepare(); self.assertEqual(r.returncode,0,r.stderr)
        dest=pathlib.Path(r.stdout); self.assertEqual(set(p.name for p in dest.iterdir()),set(FILES))
        for f in FILES: self.assertEqual((dest/f).read_bytes(), self.content[f])
    def test_same_version_reuses_unchanged_directory(self):
        self.package(); a=self.run_prepare(); self.assertEqual(a.returncode,0,a.stderr)
        before=(pathlib.Path(a.stdout)/'popup.js').stat().st_mtime_ns
        b=self.run_prepare(); self.assertEqual(b.returncode,0,b.stderr); self.assertEqual(a.stdout,b.stdout)
        self.assertEqual((pathlib.Path(b.stdout)/'popup.js').stat().st_mtime_ns,before)
    def test_changed_existing_data_is_not_overwritten(self):
        self.package(); a=self.run_prepare(); target=pathlib.Path(a.stdout)/'popup.js'; target.write_text('KEEP USER DATA')
        b=self.run_prepare(); self.assertNotEqual(b.returncode,0); self.assertEqual(target.read_text(),'KEEP USER DATA')
    def test_existing_extra_file_is_preserved(self):
        self.package(); a=self.run_prepare(); target=pathlib.Path(a.stdout)/'personal.txt'; target.write_text('KEEP')
        self.assertNotEqual(self.run_prepare().returncode,0); self.assertEqual(target.read_text(),'KEEP')
    def test_hash_mismatch_rejected_before_install(self):
        self.package(); self.archive.write_bytes(self.archive.read_bytes()+b'corrupt')
        self.assertNotEqual(self.run_prepare().returncode,0); self.assertEqual(list(self.root.iterdir()),[])
    def test_html_masquerade_even_with_matching_hash_rejected(self):
        self.archive.write_text('<html>error</html>'); self.write_hashes()
        self.assertNotEqual(self.run_prepare().returncode,0)
    def test_path_traversal_absolute_ads_and_unknown_rejected(self):
        for name in ('../outside.txt','/tmp/outside.txt','C:\\outside.txt','popup.js:stream','unexpected.txt','a/../popup.js','./popup.js','manifest.json\n../other'):
            with self.subTest(name=name):
                self.package(extra=(name,b'bad'))
                self.assertNotEqual(self.run_prepare().returncode,0)
                self.assertEqual(list(self.root.iterdir()),[])
    def test_duplicate_rejected(self):
        self.package(extra=('popup.js',b'bad')); self.assertNotEqual(self.run_prepare().returncode,0)
    def test_missing_file_rejected(self):
        self.package(omit='popup.css'); self.assertNotEqual(self.run_prepare().returncode,0)
    def test_symbolic_link_rejected(self):
        self.package(symlink='popup.js'); self.assertNotEqual(self.run_prepare().returncode,0)
    def test_per_file_checksum_rejected(self):
        content={**self.content,'popup.js':b'not-the-checksum'}; self.package(content=content)
        self.assertNotEqual(self.run_prepare().returncode,0); self.assertEqual(list(self.root.iterdir()),[])
    def test_corrupt_checksum_manifest_rejected(self):
        self.package(); self.checksum.write_text(self.checksum.read_text().replace('popup.css','../escape'))
        self.assertNotEqual(self.run_prepare().returncode,0)
    def test_root_symlink_rejected(self):
        self.package(); self.root.rmdir(); elsewhere=self.path/'elsewhere'; elsewhere.mkdir(); self.root.symlink_to(elsewhere,target_is_directory=True)
        self.assertNotEqual(self.run_prepare().returncode,0); self.assertEqual(list(elsewhere.iterdir()),[])
    def test_destination_symlink_rejected(self):
        self.package(); name='release-'+hashlib.sha256(self.archive.read_bytes()).hexdigest()
        elsewhere=self.path/'elsewhere'; elsewhere.mkdir(); (self.root/name).symlink_to(elsewhere,target_is_directory=True)
        self.assertNotEqual(self.run_prepare().returncode,0); self.assertEqual(list(elsewhere.iterdir()),[])
    def test_zip_bomb_output_bounded(self):
        # Highly compressible data fits ZIP download limit but hits per-entry OS output limit.
        self.content['popup.js']=b'0'*(10*1024*1024)
        self.package()
        # Re-compress fixtures (the ordinary ZipInfo cases deliberately use STORE).
        with zipfile.ZipFile(self.archive,'w',zipfile.ZIP_DEFLATED) as z:
            for f,data in self.content.items(): z.writestr(f,data)
        self.write_hashes(); self.assertLess(self.archive.stat().st_size,8388608)
        self.assertNotEqual(self.run_prepare().returncode,0); self.assertEqual(list(self.root.iterdir()),[])
    def test_package_too_large_rejected(self):
        self.archive.write_bytes(b'0'*8388609); self.write_hashes()
        self.assertNotEqual(self.run_prepare().returncode,0)

if __name__=='__main__': unittest.main(verbosity=2)
