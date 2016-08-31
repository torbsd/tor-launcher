// When presenting the setup wizard, first prompt for locale.
pref("intl.locale.matchOS", true);
pref("extensions.torlauncher.prompt_for_locale", true);

pref("extensions.torlauncher.start_tor", true);
pref("extensions.torlauncher.prompt_at_startup", true);

pref("extensions.torlauncher.loglevel", 4);  // 1=verbose, 2=debug, 3=info, 4=note, 5=warn
pref("extensions.torlauncher.logmethod", 1);  // 0=stdout, 1=errorconsole, 2=debuglog
pref("extensions.torlauncher.max_tor_log_entries", 1000);

// By default, a Unix domain socket at a default location is used for
// the Tor control port.
// Change control_port_use_socket to false to use a TCP connection
// instead, as defined by control_host and control_port.
// Modify control_socket_path to override the default socket location. If a
// relative path is used, it is handled like torrc_path (see below).
pref("extensions.torlauncher.control_port_use_socket", true);
pref("extensions.torlauncher.control_socket_path", "");
pref("extensions.torlauncher.control_host", "127.0.0.1");
pref("extensions.torlauncher.control_port", 9151);

// The tor_path is relative to the application directory. On Linux and
// Windows this is the Browser/ directory that contains the firefox
// executables, and on Mac OS it is the TorBrowser.app directory.
pref("extensions.torlauncher.tor_path", "");

// The torrc_path and tordatadir_path are relative to the data directory,
// which is TorBrowser-Data/ if it exists as a sibling of the application
// directory. If TorBrowser-Data/ does not exist, these paths are relative
// to the TorBrowser/ directory within the application directory.
pref("extensions.torlauncher.torrc_path", "");
pref("extensions.torlauncher.tordatadir_path", "");

// Recommended default bridge type (can be set per localized bundle).
// pref("extensions.torlauncher.default_bridge_recommended_type", "obfs3");

// Default bridges.
// pref("extensions.torlauncher.default_bridge.TYPE.1", "TYPE x.x.x.x:yy");
// pref("extensions.torlauncher.default_bridge.TYPE.2", "TYPE x.x.x.x:yy");
