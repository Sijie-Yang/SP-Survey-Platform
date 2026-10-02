"""Per-user CA and localhost certificate for the helper's HTTPS listener.

Generated on first `serve` under ~/.sp-streetlevel/certs/ (never in the repo, never a
shared key). macOS trusts the CA in the login keychain; Windows tries the current-user
root store; Linux only prints the trust command.
"""

from __future__ import annotations

import datetime
import ipaddress
import os
import ssl
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CA_COMMON_NAME = "sp-streetlevel local CA"
LEAF_DAYS = 825
CA_DAYS = 3650
Run = Callable[..., object]


@dataclass(frozen=True)
class LocalCerts:
    directory: Path
    ca_key: Path
    ca_cert: Path
    leaf_key: Path
    leaf_cert: Path


def default_cert_dir() -> Path:
    return Path.home() / ".sp-streetlevel" / "certs"


def _cn(name: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])


def _write_private_key(path: Path, key) -> None:
    data = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)
    os.chmod(path, 0o600)


def _write_cert(path: Path, cert: x509.Certificate) -> None:
    path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def _expires(cert: x509.Certificate) -> datetime.datetime:
    if hasattr(cert, "not_valid_after_utc"):
        return cert.not_valid_after_utc
    return cert.not_valid_after.replace(tzinfo=datetime.timezone.utc)


def _load_pair(ca_path: Path, leaf_path: Path):
    ca = x509.load_pem_x509_certificate(ca_path.read_bytes())
    leaf = x509.load_pem_x509_certificate(leaf_path.read_bytes())
    return ca, leaf


def _certs_usable(paths: LocalCerts) -> bool:
    try:
        if not all(p.is_file() for p in (paths.ca_key, paths.ca_cert, paths.leaf_key, paths.leaf_cert)):
            return False
        ca, leaf = _load_pair(paths.ca_cert, paths.leaf_cert)
        now = datetime.datetime.now(datetime.timezone.utc)
        if _expires(ca) < now + datetime.timedelta(days=1):
            return False
        if _expires(leaf) < now + datetime.timedelta(days=7):
            return False
        if ca.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value != CA_COMMON_NAME:
            return False
        basic = ca.extensions.get_extension_for_class(x509.BasicConstraints).value
        if not basic.ca:
            return False
        san = leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        if "localhost" not in san.get_values_for_type(x509.DNSName):
            return False
        if ipaddress.ip_address("127.0.0.1") not in san.get_values_for_type(x509.IPAddress):
            return False
        if hasattr(leaf, "verify_directly_issued_by"):
            leaf.verify_directly_issued_by(ca)
        return True
    except Exception:
        return False


def _generate(directory: Path) -> LocalCerts:
    directory.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    paths = LocalCerts(
        directory=directory,
        ca_key=directory / "ca.key",
        ca_cert=directory / "ca.crt",
        leaf_key=directory / "127.0.0.1.key",
        leaf_cert=directory / "127.0.0.1.crt",
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = _cn(CA_COMMON_NAME)
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=CA_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )
    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(_cn("127.0.0.1"))
        .issuer_name(ca_name)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=LEAF_DAYS))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            ]),
            critical=False,
        )
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=True,
                data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )
    _write_private_key(paths.ca_key, ca_key)
    _write_cert(paths.ca_cert, ca_cert)
    _write_private_key(paths.leaf_key, leaf_key)
    _write_cert(paths.leaf_cert, leaf_cert)
    return paths


def ensure_certs(directory: Optional[Path] = None) -> LocalCerts:
    """Create the CA and leaf on first use. Reuse them when they are still valid."""
    directory = Path(directory) if directory else default_cert_dir()
    paths = LocalCerts(
        directory=directory,
        ca_key=directory / "ca.key",
        ca_cert=directory / "ca.crt",
        leaf_key=directory / "127.0.0.1.key",
        leaf_cert=directory / "127.0.0.1.crt",
    )
    if _certs_usable(paths):
        return paths
    return _generate(directory)


def server_ssl_context(paths: LocalCerts) -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(paths.leaf_cert), str(paths.leaf_key))
    return ctx


def client_ssl_context(paths: LocalCerts) -> ssl.SSLContext:
    """Client context that trusts this helper's CA. Tests use it; browsers use the OS store."""
    return ssl.create_default_context(cafile=str(paths.ca_cert))


def login_keychain() -> Path:
    base = Path.home() / "Library" / "Keychains"
    modern = base / "login.keychain-db"
    if modern.exists():
        return modern
    return base / "login.keychain"


def macos_already_trusted(ca_path: Path, *, run: Run = subprocess.run, keychain: Optional[Path] = None) -> bool:
    """Read-only check. Callers in CI pass a fake `run` and never touch the login keychain."""
    chain = keychain or login_keychain()
    found = run(
        ["security", "find-certificate", "-c", CA_COMMON_NAME, "-a", str(chain)],
        capture_output=True, text=True,
    )
    if getattr(found, "returncode", 1) != 0:
        return False
    dumped = run(["security", "dump-trust-settings"], capture_output=True, text=True)
    text = f"{getattr(dumped, 'stdout', '')}\n{getattr(dumped, 'stderr', '')}"
    return CA_COMMON_NAME in text and "TrustRoot" in text


def windows_trust_command(ca_path: Path) -> str:
    return f'certutil -user -addstore Root "{ca_path}"'


def linux_trust_command(ca_path: Path) -> str:
    return (
        f'sudo cp "{ca_path}" /usr/local/share/ca-certificates/sp-streetlevel-local-ca.crt'
        f" && sudo update-ca-certificates"
    )


def _returncode(result) -> int:
    if result is None:
        return 1
    return int(getattr(result, "returncode", 1))


def trust_local_ca(
    ca_path: Path,
    *,
    platform: str = sys.platform,
    run: Run = subprocess.run,
    already_trusted: Optional[Callable[[Path], bool]] = None,
    keychain: Optional[Path] = None,
) -> None:
    """Trust the CA for this user. Never raises: a dismissed prompt still leaves the server up."""
    system = platform.lower()
    if system == "darwin":
        checker = already_trusted or (lambda path: macos_already_trusted(path, run=run, keychain=keychain))
        try:
            trusted = bool(checker(ca_path))
        except Exception:
            trusted = False
        if trusted:
            return
        print(
            "Approve the macOS prompt to trust the local certificate so Safari can use the Download button.",
            flush=True,
        )
        chain = keychain or login_keychain()
        try:
            run(
                ["security", "add-trusted-cert", "-r", "trustRoot", "-p", "ssl", "-k", str(chain), str(ca_path)],
                capture_output=True, text=True,
            )
        except Exception as err:
            print(f"Could not start the trust prompt ({err}). The helper is still running.", flush=True)
        return

    if system.startswith("win"):
        if already_trusted is not None:
            try:
                if already_trusted(ca_path):
                    return
            except Exception:
                pass
        else:
            try:
                found = run(["certutil", "-user", "-verifystore", "Root", CA_COMMON_NAME], capture_output=True, text=True)
                if _returncode(found) == 0:
                    return
            except Exception:
                pass
        try:
            result = run(["certutil", "-user", "-addstore", "Root", str(ca_path)], capture_output=True, text=True)
        except Exception:
            result = None
        if _returncode(result) != 0:
            print(f"Trust the local certificate for the current user by running: {windows_trust_command(ca_path)}", flush=True)
        return

    print(f"Trust the local certificate by running: {linux_trust_command(ca_path)}", flush=True)
