from .deps import explain_import_error

try:
    from .cli import main
except OSError as err:  # native library missing (e.g. pyexiv2 on macOS)
    raise SystemExit(explain_import_error(err))

raise SystemExit(main())
