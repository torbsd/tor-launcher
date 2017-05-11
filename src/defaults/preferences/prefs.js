// When presenting the setup wizard, first prompt for locale.
pref("intl.locale.matchOS", true);
pref("extensions.torlauncher.prompt_for_locale", true);

pref("extensions.torlauncher.start_tor", true);
pref("extensions.torlauncher.prompt_at_startup", true);

pref("extensions.torlauncher.loglevel", 4);  // 1=verbose, 2=debug, 3=info, 4=note, 5=warn
pref("extensions.torlauncher.logmethod", 1);  // 0=stdout, 1=errorconsole, 2=debuglog
pref("extensions.torlauncher.max_tor_log_entries", 1000);

// By default, Tor Launcher configures a TCP listener for the Tor
// control port, as defined by control_host and control_port.
// Set control_port_use_ipc to true to use an IPC object (e.g., a Unix
// domain socket) instead. You may also modify control_ipc_path to
// override the default IPC object location. If a relative path is used,
// it is handled like torrc_path (see below).
pref("extensions.torlauncher.control_host", "127.0.0.1");
pref("extensions.torlauncher.control_port", 9151);
pref("extensions.torlauncher.control_port_use_ipc", false);
pref("extensions.torlauncher.control_ipc_path", "");

// By default, Tor Launcher configures a TCP listener for the Tor
// SOCKS port. The host is taken from the network.proxy.socks pref and
// the port is taken from the network.proxy.socks_port pref.
// Set socks_port_use_ipc to true to use an IPC object (e.g., a Unix
// domain socket) instead. You may also modify socks_ipc_path to
// override the default IPC object location. If a relative path is used,
// it is handled like torrc_path (see below).
// Modify socks_port_flags to use a different set of SocksPort flags (but be
// careful).
pref("extensions.torlauncher.socks_port_use_ipc", false);
pref("extensions.torlauncher.socks_ipc_path", "");
pref("extensions.torlauncher.socks_port_flags", "IPv6Traffic PreferIPv6 KeepAliveIsolateSOCKSAuth");

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
