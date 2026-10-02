from sp_streetlevel.deps import MAC_SYSTEM_DEPS, explain_import_error

MAC_ERR = OSError("dlopen(/x/pyexiv2/lib/libexiv2.dylib, 0x0002): Library not loaded: "
                  "/opt/homebrew/opt/inih/lib/libINIReader.0.dylib")


def test_macos_pyexiv2_error_names_the_homebrew_fix():
    msg = explain_import_error(MAC_ERR, platform="darwin")
    assert MAC_SYSTEM_DEPS in msg and "brew install gettext && brew install inih" in msg
    assert "https://brew.sh" in msg and "libINIReader" in msg


def test_other_platforms_get_the_plain_error():
    msg = explain_import_error(MAC_ERR, platform="linux")
    assert "brew install" not in msg and "libINIReader" in msg
