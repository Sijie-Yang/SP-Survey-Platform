"""Local CA generation. These tests never call the macOS keychain, certutil, or security(1)."""

import datetime
import ipaddress
import stat
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from cryptography.x509.oid import NameOID

from sp_streetlevel.certs import (
    CA_COMMON_NAME,
    ensure_certs,
    linux_trust_command,
    macos_already_trusted,
    trust_local_ca,
    windows_trust_command,
)


def _mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def test_generates_a_private_ca_and_localhost_leaf(tmp_path):
    paths = ensure_certs(tmp_path)
    assert paths.ca_key.is_file() and paths.leaf_key.is_file()
    assert _mode(paths.ca_key) == 0o600
    assert _mode(paths.leaf_key) == 0o600
    assert paths.directory == tmp_path

    ca = x509.load_pem_x509_certificate(paths.ca_cert.read_bytes())
    leaf = x509.load_pem_x509_certificate(paths.leaf_cert.read_bytes())
    assert ca.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value == CA_COMMON_NAME
    assert ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca is True
    san = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert "localhost" in san.get_values_for_type(x509.DNSName)
    assert ipaddress.ip_address("127.0.0.1") in san.get_values_for_type(x509.IPAddress)
    leaf.verify_directly_issued_by(ca)
    expires = leaf.not_valid_after_utc if hasattr(leaf, "not_valid_after_utc") else leaf.not_valid_after
    assert expires > datetime.datetime.now(datetime.timezone.utc)

    ca_key = load_pem_private_key(paths.ca_key.read_bytes(), password=None)
    assert ca_key.public_key().public_numbers() == ca.public_key().public_numbers()


def test_reuses_keys_and_never_shares_them_across_directories(tmp_path):
    first = ensure_certs(tmp_path / "one")
    again = ensure_certs(tmp_path / "one")
    other = ensure_certs(tmp_path / "two")
    assert again.ca_key.read_bytes() == first.ca_key.read_bytes()
    assert again.leaf_cert.read_bytes() == first.leaf_cert.read_bytes()
    assert other.ca_key.read_bytes() != first.ca_key.read_bytes()
    assert other.leaf_key.read_bytes() != first.leaf_key.read_bytes()


def test_regenerates_when_the_leaf_is_replaced(tmp_path):
    paths = ensure_certs(tmp_path)
    original = paths.ca_key.read_bytes()
    paths.leaf_cert.write_text("not a certificate\n", encoding="utf-8")
    fresh = ensure_certs(tmp_path)
    assert fresh.ca_key.read_bytes() != original
    x509.load_pem_x509_certificate(fresh.leaf_cert.read_bytes()).verify_directly_issued_by(
        x509.load_pem_x509_certificate(fresh.ca_cert.read_bytes())
    )


def test_generation_does_not_invoke_trust_tools(tmp_path, monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("cert generation must not touch the keychain or certutil")

    monkeypatch.setattr("sp_streetlevel.certs.subprocess.run", boom)
    ensure_certs(tmp_path / "isolated")


def test_macos_trust_prompts_once_and_ignores_a_failed_or_existing_trust(tmp_path, capsys):
    calls = []

    class Result:
        def __init__(self, code):
            self.returncode = code
            self.stdout = ""
            self.stderr = ""

    def run(cmd, **_kwargs):
        calls.append(list(cmd))
        return Result(1)

    ca = tmp_path / "ca.crt"
    ca.write_text("cert\n", encoding="utf-8")
    trust_local_ca(ca, platform="darwin", run=run, already_trusted=lambda _path: False, keychain=tmp_path / "login.keychain-db")
    assert calls[0][0] == "security"
    assert calls[0][1:6] == ["add-trusted-cert", "-r", "trustRoot", "-p", "ssl"]
    assert str(tmp_path / "login.keychain-db") in calls[0]
    assert "Approve the macOS prompt" in capsys.readouterr().out

    calls.clear()
    trust_local_ca(ca, platform="darwin", run=run, already_trusted=lambda _path: True, keychain=tmp_path / "login.keychain-db")
    assert calls == []
    assert capsys.readouterr().out == ""


def test_macos_already_trusted_uses_only_the_injected_runner(tmp_path):
    seen = []

    class Result:
        returncode = 0
        stdout = f"Cert 0: {CA_COMMON_NAME}\nResult Type = kSecTrustSettingsResultTrustRoot\n"
        stderr = ""

    def run(cmd, **_kwargs):
        seen.append(list(cmd))
        return Result()

    assert macos_already_trusted(tmp_path / "ca.crt", run=run, keychain=tmp_path / "login.keychain-db") is True
    assert [cmd[1] for cmd in seen] == ["find-certificate", "dump-trust-settings"]
    assert macos_already_trusted(
        tmp_path / "ca.crt",
        run=lambda cmd, **_kwargs: type("R", (), {"returncode": 1, "stdout": "", "stderr": ""})(),
        keychain=tmp_path / "login.keychain-db",
    ) is False


def test_windows_uses_the_current_user_store_or_prints_the_command(tmp_path, capsys):
    calls = []

    class Result:
        def __init__(self, code):
            self.returncode = code

    def run(cmd, **_kwargs):
        calls.append(list(cmd))
        return Result(0)

    ca = tmp_path / "ca.crt"
    ca.write_text("cert\n", encoding="utf-8")
    trust_local_ca(ca, platform="win32", run=run, already_trusted=lambda _path: False)
    assert calls == [["certutil", "-user", "-addstore", "Root", str(ca)]]
    assert capsys.readouterr().out == ""

    def fail(cmd, **_kwargs):
        calls.append(list(cmd))
        return Result(1)

    calls.clear()
    other = tmp_path / "other" / "ca.crt"
    other.parent.mkdir()
    other.write_text("cert\n", encoding="utf-8")
    trust_local_ca(other, platform="win32", run=fail, already_trusted=lambda _path: False)
    assert windows_trust_command(other) in capsys.readouterr().out


def test_linux_prints_one_command_and_does_not_run_it(tmp_path, capsys):
    def boom(*_args, **_kwargs):
        raise AssertionError("linux trust must only be printed")

    ca = tmp_path / "ca.crt"
    trust_local_ca(ca, platform="linux", run=boom)
    out = capsys.readouterr().out.strip()
    assert out.count("\n") == 0
    assert out.endswith(linux_trust_command(ca))
    assert "update-ca-certificates" in out


def test_dismissed_macos_prompt_does_not_raise(tmp_path):
    ca = tmp_path / "ca.crt"
    ca.write_text("cert\n", encoding="utf-8")

    class Result:
        returncode = 1
        stdout = ""
        stderr = "cancelled"

    trust_local_ca(
        ca, platform="darwin",
        run=lambda *_args, **_kwargs: Result(),
        already_trusted=lambda _path: False,
        keychain=tmp_path / "login.keychain-db",
    )
