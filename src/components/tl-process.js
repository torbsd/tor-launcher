// Copyright (c) 2016, The Tor Project, Inc.
// See LICENSE for licensing information.
//
// vim: set sw=2 sts=2 ts=8 et syntax=javascript:

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// ctypes can be disabled at build time
try { Cu.import("resource://gre/modules/ctypes.jsm"); } catch(e) {}
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherUtil",
                          "resource://torlauncher/modules/tl-util.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherLogger",
                          "resource://torlauncher/modules/tl-logger.jsm");

function TorProcessService()
{
  this.wrappedJSObject = this;
  this.mProtocolSvc = Cc["@torproject.org/torlauncher-protocol-service;1"]
                .getService(Ci.nsISupports).wrappedJSObject;
}


TorProcessService.prototype =
{
  kContractID : "@torproject.org/torlauncher-process-service;1",
  kServiceName : "Tor Launcher Process Service",
  kClassID: Components.ID("{FE7B4CAF-BCF4-4848-8BFF-EFA66C9AFDA1}"),
  kTorLauncherExtPath: "tor-launcher@torproject.org", // This could vary.

  kPrefPromptAtStartup: "extensions.torlauncher.prompt_at_startup",
  kPrefDefaultBridgeType: "extensions.torlauncher.default_bridge_type",

  kInitialControlConnDelayMS: 25,
  kMaxControlConnRetryMS: 500,
  kControlConnTimeoutMS: 30000, // Wait at most 30 seconds for tor to start.

  kStatusUnknown: 0, // Tor process status.
  kStatusStarting: 1,
  kStatusRunning: 2,
  kStatusExited: 3,  // Exited or failed to start.

  kDefaultBridgesStatus_NotInUse: 0,
  kDefaultBridgesStatus_InUse: 1,
  kDefaultBridgesStatus_BadConfig: 2,

  // nsISupports implementation.
  QueryInterface: function(aIID)
  {
    if (!aIID.equals(Ci.nsISupports) &&
        !aIID.equals(Ci.nsIFactory) &&
        !aIID.equals(Ci.nsIObserver) &&
        !aIID.equals(Ci.nsIClassInfo))
    {
      throw Cr.NS_ERROR_NO_INTERFACE;
    }

    return this;
  },

  // nsIFactory implementation.
  createInstance: function(aOuter, aIID)
  {
    if (null != aOuter)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return this.QueryInterface(aIID);
  },

  lockFactory: function(aDoLock) {},

  // nsIObserver implementation.
  observe: function(aSubject, aTopic, aParam)
  {
    const kOpenNetworkSettingsTopic = "TorOpenNetworkSettings";
    const kUserQuitTopic = "TorUserRequestedQuit";
    const kBootstrapStatusTopic = "TorBootstrapStatus";

    if (!this.mObsSvc)
    {
      this.mObsSvc = Cc["@mozilla.org/observer-service;1"]
                        .getService(Ci.nsIObserverService);
    }

    if ("profile-after-change" == aTopic)
    {
      this.mObsSvc.addObserver(this, "quit-application-granted", false);
      this.mObsSvc.addObserver(this, kOpenNetworkSettingsTopic, false);
      this.mObsSvc.addObserver(this, kUserQuitTopic, false);
      this.mObsSvc.addObserver(this, kBootstrapStatusTopic, false);

      if (TorLauncherUtil.shouldOnlyConfigureTor)
      {
        this._controlTor();
      }
      else if (TorLauncherUtil.shouldStartAndOwnTor)
      {
        this._startTor();
        this._controlTor();
      }
    }
    else if ("quit-application-granted" == aTopic)
    {
      this.mIsQuitting = true;
      this.mObsSvc.removeObserver(this, "quit-application-granted");
      this.mObsSvc.removeObserver(this, kOpenNetworkSettingsTopic);
      this.mObsSvc.removeObserver(this, kUserQuitTopic);
      this.mObsSvc.removeObserver(this, kBootstrapStatusTopic);
      if (this.mTorProcess)
      {
        // We now rely on the TAKEOWNERSHIP feature to shut down tor when we
        // close the control port connection.
        //
        // Previously, we sent a SIGNAL HALT command to the tor control port,
        // but that caused hangs upon exit in the Firefox 24.x based browser.
        // Apparently, Firefox does not like to process socket I/O while
        // quitting if the browser did not finish starting up (e.g., when
        // someone presses the Quit button on our Network Settings or progress
        // window during startup).
        TorLauncherLogger.log(4, "Disconnecting from tor process (pid "
                                   + this.mTorProcess.pid + ")");
        this.mProtocolSvc.TorCleanupConnection();

        this.mTorProcess = null;
      }
    }
    else if (("process-failed" == aTopic) || ("process-finished" == aTopic))
    {
      if (this.mControlConnTimer)
      {
        this.mControlConnTimer.cancel();
        this.mControlConnTimer = null;
      }

      this.mTorProcess = null;
      this.mTorProcessStatus = this.kStatusExited;
      this.mIsBootstrapDone = false;

      this.mObsSvc.notifyObservers(null, "TorProcessExited", null);

      if (this.mIsQuitting)
      {
        TorLauncherUtil.cleanupTempDirectories();
      }
      else
      {
        this.mProtocolSvc.TorCleanupConnection();

        let s;
        if (!this.mDidConnectToTorControlPort)
        {
          // The "tor_exited_during_startup" property string was added in
          // May 2016. If it is available, we use it; otherwise, we fall back
          // to the older "tor_exited" message (below). Once this new string
          // has been translated into all of the languages that we ship, we
          // can simplify this code.
          let key = "tor_exited_during_startup";
          s = TorLauncherUtil.getLocalizedString(key)
          if (s == key)  // No string found for key.
            s = undefined;
        }

        if (!s)
        {
          s = TorLauncherUtil.getLocalizedString("tor_exited") + "\n\n"
                + TorLauncherUtil.getLocalizedString("tor_exited2");
        }
        TorLauncherLogger.log(4, s);
        var defaultBtnLabel = TorLauncherUtil.getLocalizedString("restart_tor");
        var cancelBtnLabel = "OK";
        try
        {
          const kSysBundleURI = "chrome://global/locale/commonDialogs.properties";
          var sysBundle = Cc["@mozilla.org/intl/stringbundle;1"]
             .getService(Ci.nsIStringBundleService).createBundle(kSysBundleURI);
          cancelBtnLabel = sysBundle.GetStringFromName(cancelBtnLabel);
        } catch(e) {}

        if (TorLauncherUtil.showConfirm(null, s, defaultBtnLabel, cancelBtnLabel)
            && !this.mIsQuitting)
        {
          this._startTor();
          this._controlTor();
        }
      }
    }
    else if ("timer-callback" == aTopic)
    {
      if (aSubject == this.mControlConnTimer)
      {
        var haveConnection = this.mProtocolSvc.TorHaveControlConnection();
        if (haveConnection)
        {
          this.mDidConnectToTorControlPort = true;
          this.mControlConnTimer = null;
          this.mTorProcessStatus = this.kStatusRunning;
          this.mProtocolSvc.TorStartEventMonitor();

          this.mProtocolSvc.TorRetrieveBootstrapStatus();

          if (this._defaultBridgesStatus == this.kDefaultBridgesStatus_InUse)
          {
            // We configure default bridges each time we start tor in case
            // new default bridge preference values are available (e.g., due
            // to a TBB update).
            this._configureDefaultBridges();
          }

          this.mObsSvc.notifyObservers(null, "TorProcessIsReady", null);
        }
        else if ((Date.now() - this.mTorProcessStartTime)
                 > this.kControlConnTimeoutMS)
        {
          var s = TorLauncherUtil.getLocalizedString("tor_controlconn_failed");
          this.mObsSvc.notifyObservers(null, "TorProcessDidNotStart", s);
          TorLauncherUtil.showAlert(null, s);
          TorLauncherLogger.log(4, s);
        }
        else
        {
          this.mControlConnDelayMS *= 2;
          if (this.mControlConnDelayMS > this.kMaxControlConnRetryMS)
            this.mControlConnDelayMS = this.kMaxControlConnRetryMS;
          this.mControlConnTimer = Cc["@mozilla.org/timer;1"]
                                  .createInstance(Ci.nsITimer);
          this.mControlConnTimer.init(this, this.mControlConnDelayMS,
                                      this.mControlConnTimer .TYPE_ONE_SHOT);
        }
      }
    }
    else if (kBootstrapStatusTopic == aTopic)
      this._processBootstrapStatus(aSubject.wrappedJSObject);
    else if (kOpenNetworkSettingsTopic == aTopic)
      this._openNetworkSettings(false);
    else if (kUserQuitTopic == aTopic)
    {
      this.mQuitSoon = true;
      this.mRestartWithQuit = ("restart" == aParam);
    }
  },

  canUnload: function(aCompMgr) { return true; },

  // nsIClassInfo implementation.
  getInterfaces: function(aCount)
  {
    var iList = [ Ci.nsISupports,
                  Ci.nsIFactory,
                  Ci.nsIObserver,
                  Ci.nsIClassInfo ];
    aCount.value = iList.length;
    return iList;
  },

  getHelperForLanguage: function (aLanguage) { return null; },

  contractID: this.kContractID,
  classDescription: this.kServiceName,
  classID: this.kClassID,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: Ci.nsIClassInfo.DOM_OBJECT,

  // nsIFactory implementation.
  createInstance: function (aOuter, aIID)
  {
    if (null != aOuter)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return this.QueryInterface(aIID);
  },

  lockFactory: function (aDoLock) {},


  // Public Properties and Methods ///////////////////////////////////////////
  get TorProcessStatus()
  {
    return this.mTorProcessStatus;
  },

  get TorIsBootstrapDone()
  {
    return this.mIsBootstrapDone;
  },

  get TorBootstrapErrorOccurred()
  {
    return this.mBootstrapErrorOccurred;
  },


  TorClearBootstrapError: function()
  {
    this.mBootstrapErrorOccurred = false;
    this.mLastTorWarningPhase = null;
    this.mLastTorWarningReason = null;
  },


  // Private Member Variables ////////////////////////////////////////////////
  mTorProcessStatus: 0,  // kStatusUnknown
  mDidConnectToTorControlPort: false,  // Have we ever made a connection?
  mIsBootstrapDone: false,
  mBootstrapErrorOccurred: false,
  mIsQuitting: false,
  mObsSvc: null,
  mProtocolSvc: null,
  mTorProcess: null,    // nsIProcess
  mTorProcessStartTime: null, // JS Date.now()
  mControlConnTimer: null,
  mControlConnDelayMS: 0,
  mQuitSoon: false,     // Quit was requested by the user; do so soon.
  mRestartWithQuit: false,
  mLastTorWarningPhase: null,
  mLastTorWarningReason: null,


  // Private Methods /////////////////////////////////////////////////////////
  _startTor: function()
  {
    this.mTorProcessStatus = this.kStatusUnknown;

    try
    {
      // Ideally, we would cd to the Firefox application directory before
      // starting tor (but we don't know how to do that).  Instead, we
      // rely on the TBB launcher to start Firefox from the right place.

      // Get the Tor data directory first so it is created before we try to
      // construct paths to files that will be inside it.
      var dataDir = TorLauncherUtil.getTorFile("tordatadir", true);
      var exeFile = TorLauncherUtil.getTorFile("tor", false);
      var torrcFile = TorLauncherUtil.getTorFile("torrc", true);
      var torrcDefaultsFile =
                    TorLauncherUtil.getTorFile("torrc-defaults", false);
      var hashedPassword = this.mProtocolSvc.TorGetPassword(true);
      var controlIPCFile = this.mProtocolSvc.TorGetControlIPCFile();
      var controlPort = this.mProtocolSvc.TorGetControlPort();
      var socksPortInfo = this.mProtocolSvc.TorGetSOCKSPortInfo();

      var detailsKey;
      if (!exeFile)
        detailsKey = "tor_missing";
      else if (!torrcFile)
        detailsKey = "torrc_missing";
      else if (!dataDir)
        detailsKey = "datadir_missing";
      else if (!hashedPassword)
        detailsKey = "password_hash_missing";

      if (detailsKey)
      {
        var details = TorLauncherUtil.getLocalizedString(detailsKey);
        var key = "unable_to_start_tor";
        var err = TorLauncherUtil.getFormattedLocalizedString(key,
                                                                [details], 1);
        TorLauncherUtil.showAlert(null, err);
        return;
      }

      // The geoip and geoip6 files are in the same directory as torrc-defaults.
      var geoipFile = torrcDefaultsFile.clone();
      geoipFile.leafName = "geoip";

      var geoip6File = torrcDefaultsFile.clone();
      geoip6File.leafName = "geoip6";

      var args = [];
      if (torrcDefaultsFile)
      {
        args.push("--defaults-torrc");
        args.push(torrcDefaultsFile.path);
      }
      args.push("-f");
      args.push(torrcFile.path);
      args.push("DataDirectory");
      args.push(dataDir.path);
      args.push("GeoIPFile");
      args.push(geoipFile.path);
      args.push("GeoIPv6File");
      args.push(geoip6File.path);
      args.push("HashedControlPassword");
      args.push(hashedPassword);

      // Include a ControlPort argument to support switching between
      // a TCP port and an IPC port (e.g., a Unix domain socket).
      let controlPortArg;
      if (controlIPCFile)
        controlPortArg = this._ipcPortArg(controlIPCFile);
      else if (controlPort)
        controlPortArg = "" + controlPort;
      if (controlPortArg)
      {
        args.push("ControlPort");
        args.push(controlPortArg);
      }

      // Include a SocksPort argument to support switching between
      // a TCP port and an IPC port (e.g., a Unix domain socket).
      if (socksPortInfo)
      {
        let socksPortArg;
        if (socksPortInfo.ipcFile)
          socksPortArg = this._ipcPortArg(socksPortInfo.ipcFile)
        else if (socksPortInfo.host && (socksPortInfo.port != 0))
          socksPortArg = socksPortInfo.host + ':' + socksPortInfo.port;

        if (socksPortArg)
        {
          let socksPortFlags = TorLauncherUtil.getCharPref(
                                  "extensions.torlauncher.socks_port_flags");
          if (socksPortFlags)
            socksPortArg += ' ' + socksPortFlags;
          args.push("SocksPort");
          args.push(socksPortArg);
        }
      }

      var pid = this._getpid();
      if (0 != pid)
      {
        args.push("__OwningControllerProcess");
        args.push("" + pid);
      }

      // Start tor with networking disabled if first run or if the
      // "Use Default Bridges of Type" option is turned on.  Networking will
      // be enabled after initial settings are chosen or after the default
      // bridge settings have been configured.
      var defaultBridgeType =
                    TorLauncherUtil.getCharPref(this.kPrefDefaultBridgeType);
      var bridgeConfigIsBad = (this._defaultBridgesStatus ==
                               this.kDefaultBridgesStatus_BadConfig);
      if (bridgeConfigIsBad)
      {
        var key = "error_bridge_bad_default_type";
        var err = TorLauncherUtil.getFormattedLocalizedString(key,
                                                     [defaultBridgeType], 1);
        TorLauncherUtil.showAlert(null, err);
      }

      if (TorLauncherUtil.shouldShowNetworkSettings || defaultBridgeType)
      {
        args.push("DisableNetwork");
        args.push("1");
      }

      // On Windows, prepend the Tor program directory to PATH.  This is
      // needed so that pluggable transports can find OpenSSL DLLs, etc.
      // See https://trac.torproject.org/projects/tor/ticket/10845
      if (TorLauncherUtil.isWindows)
      {
        var env = Cc["@mozilla.org/process/environment;1"]
                    .getService(Ci.nsIEnvironment);
        var path = exeFile.parent.path;
        if (env.exists("PATH"))
          path += ";" + env.get("PATH");
        env.set("PATH", path);
      }

      this.mTorProcessStatus = this.kStatusStarting;

      var p = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
      p.init(exeFile);

      TorLauncherLogger.log(2, "Starting " + exeFile.path);
      for (var i = 0; i < args.length; ++i)
        TorLauncherLogger.log(2, "  " + args[i]);

      p.runwAsync(args, args.length, this, false);
      this.mTorProcess = p;
      this.mTorProcessStartTime = Date.now();
    }
    catch (e)
    {
      this.mTorProcessStatus = this.kStatusExited;
      var s = TorLauncherUtil.getLocalizedString("tor_failed_to_start");
      TorLauncherUtil.showAlert(null, s);
      TorLauncherLogger.safelog(4, "_startTor error: ", e);
    }
  }, // _startTor()

  // Return a ControlPort or SocksPort argument for aIPCFile (an nsIFile).
  // The result is unix:/path or unix:"/path with spaces" with appropriate
  // C-style escaping within the path portion.
  _ipcPortArg: function(aIPCFile)
  {
    return "unix:" + this.mProtocolSvc.TorEscapeString(aIPCFile.path);
  },

  _controlTor: function()
  {
    try
    {
      this._monitorTorProcessStartup();

      var bridgeConfigIsBad = (this._defaultBridgesStatus ==
                               this.kDefaultBridgesStatus_BadConfig);
      if (TorLauncherUtil.shouldShowNetworkSettings || bridgeConfigIsBad)
      {
        if (this.mProtocolSvc)
        {
          // Show network settings wizard.  Blocks until dialog is closed.
          var panelID = (bridgeConfigIsBad) ? "bridgeSettings" : undefined;
          this._openNetworkSettings(true, panelID);
        }
      }
      else if (this._networkSettingsWindow != null)
      {
        // If network settings is open, open progress dialog via notification.
        if (this.mObsSvc)
          this.mObsSvc.notifyObservers(null, "TorOpenProgressDialog", null);
      }
      else
      {
        this._openProgressDialog();

        // Assume that the "Open Settings" button was pressed if Quit was
        // not pressed and bootstrapping did not finish.
        if (!this.mQuitSoon && !this.TorIsBootstrapDone)
          this._openNetworkSettings(true);
      }

      // If the user pressed "Quit" within settings/progress, exit.
      if (this.mQuitSoon) try
      {
        this.mQuitSoon = false;

        var asSvc = Cc["@mozilla.org/toolkit/app-startup;1"]
                      .getService(Ci.nsIAppStartup);
        var flags = asSvc.eAttemptQuit;
        if (this.mRestartWithQuit)
          flags |= asSvc.eRestart;
        asSvc.quit(flags);
      }
      catch (e)
      {
        TorLauncherLogger.safelog(4, "unable to quit browser", e);
      }
    }
    catch (e)
    {
      this.mTorProcessStatus = this.kStatusExited;
      var s = TorLauncherUtil.getLocalizedString("tor_control_failed");
      TorLauncherUtil.showAlert(null, s);
      TorLauncherLogger.safelog(4, "_controlTor error: ", e);
    }
  }, // controlTor()

  _monitorTorProcessStartup: function()
  {
    this.mControlConnDelayMS = this.kInitialControlConnDelayMS;
    this.mControlConnTimer = Cc["@mozilla.org/timer;1"]
                               .createInstance(Ci.nsITimer);
    this.mControlConnTimer.init(this, this.mControlConnDelayMS,
                                this.mControlConnTimer.TYPE_ONE_SHOT);
  },

  _processBootstrapStatus: function(aStatusObj)
  {
    if (!aStatusObj)
      return;

    if (100 == aStatusObj.PROGRESS)
    {
      this.mIsBootstrapDone = true;
      this.mBootstrapErrorOccurred = false;
      TorLauncherUtil.setBoolPref(this.kPrefPromptAtStartup, false);
    }
    else
    {
      this.mIsBootstrapDone = false;

      if (aStatusObj._errorOccurred)
      {
        this.mBootstrapErrorOccurred = true;
        TorLauncherUtil.setBoolPref(this.kPrefPromptAtStartup, true);
        var phase = TorLauncherUtil.getLocalizedBootstrapStatus(aStatusObj,
                                                                "TAG");
        var reason = TorLauncherUtil.getLocalizedBootstrapStatus(aStatusObj,
                                                                 "REASON");
        var details = TorLauncherUtil.getFormattedLocalizedString(
                          "tor_bootstrap_failed_details", [phase, reason], 2);
        TorLauncherLogger.log(5, "Tor bootstrap error: [" + aStatusObj.TAG +
                                 "/" + aStatusObj.REASON + "] " + details);

        if ((aStatusObj.TAG != this.mLastTorWarningPhase) ||
            (aStatusObj.REASON != this.mLastTorWarningReason))
        {
          this.mLastTorWarningPhase = aStatusObj.TAG;
          this.mLastTorWarningReason = aStatusObj.REASON;

          // Notify others that an error will be displayed.
          this.mObsSvc.notifyObservers(null, "TorBootstrapError", reason);

          var msg = TorLauncherUtil.getLocalizedString("tor_bootstrap_failed");
          TorLauncherUtil.showAlert(null, msg + "\n\n" + details);
        }
      }
    }
  }, // _processBootstrapStatus()

  // Returns a kDefaultBridgesStatus value.
  get _defaultBridgesStatus()
  {
    var defaultBridgeType =
                  TorLauncherUtil.getCharPref(this.kPrefDefaultBridgeType);
    if (!defaultBridgeType)
      return this.kDefaultBridgesStatus_NotInUse;

    var bridgeArray = TorLauncherUtil.defaultBridges;
    if (!bridgeArray || (0 == bridgeArray.length))
      return this.kDefaultBridgesStatus_BadConfig;

    return this.kDefaultBridgesStatus_InUse;
  },

  _configureDefaultBridges: function()
  {
    var settings = {};
    var bridgeArray = TorLauncherUtil.defaultBridges;
    var useBridges =  (bridgeArray &&  (bridgeArray.length > 0));
    settings["UseBridges"] = useBridges;
    settings["Bridge"] = bridgeArray;
    var errObj = {};
    var didSucceed = this.mProtocolSvc.TorSetConfWithReply(settings, errObj);

    // If the network settings wizard was not opened at startup, enable the
    // network so that bootstrapping will proceed with the default bridges.
    if (!TorLauncherUtil.shouldShowNetworkSettings)
    {
      settings = {};
      settings["DisableNetwork"] = false;
      if (!this.mProtocolSvc.TorSetConfWithReply(settings,
                                                 (didSucceed) ? errObj : null))
      {
        didSucceed = false;
      }
    }

    if (didSucceed)
      this.mProtocolSvc.TorSendCommand("SAVECONF");
    else
      TorLauncherUtil.showSaveSettingsAlert(null, errObj.details);
  },

  // If this window is already open, put up "starting tor" panel, focus it and return.
  // Otherwise, open the network settings dialog and block until it is closed.
  _openNetworkSettings: function(aIsInitialBootstrap, aStartAtWizardPanel)
  {
    var win = this._networkSettingsWindow;
    if (win)
    {
      // Return to "Starting tor" panel if being asked to open & dlog already exists.
      win.showStartingTorPanel();
      win.focus();
      return;
    }

    const kSettingsURL = "chrome://torlauncher/content/network-settings.xul";
    const kWizardURL = "chrome://torlauncher/content/network-settings-wizard.xul";

    var wwSvc = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                  .getService(Ci.nsIWindowWatcher);
    var winFeatures = "chrome,dialog=yes,modal,all";
    var argsArray = this._createOpenWindowArgsArray(aIsInitialBootstrap,
                                                    aStartAtWizardPanel);
    var url = (aIsInitialBootstrap) ? kWizardURL : kSettingsURL;
    wwSvc.openWindow(null, url, "_blank", winFeatures, argsArray);
  },

  get _networkSettingsWindow()
  {
    var wm = Cc["@mozilla.org/appshell/window-mediator;1"]
               .getService(Ci.nsIWindowMediator);
    return wm.getMostRecentWindow("TorLauncher:NetworkSettings");
  },

  _openProgressDialog: function()
  {
    var chromeURL = "chrome://torlauncher/content/progress.xul";
    var wwSvc = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                  .getService(Ci.nsIWindowWatcher);
    var winFeatures = "chrome,dialog=yes,modal,all";
    var argsArray = this._createOpenWindowArgsArray(true);
    wwSvc.openWindow(null, chromeURL, "_blank", winFeatures, argsArray);
  },

  _createOpenWindowArgsArray: function(aArg1, aArg2)
  {
    var argsArray = Cc["@mozilla.org/array;1"]
                      .createInstance(Ci.nsIMutableArray);
    var variant = Cc["@mozilla.org/variant;1"]
                    .createInstance(Ci.nsIWritableVariant);
    variant.setFromVariant(aArg1);
    argsArray.appendElement(variant, false);

    if (aArg2)
    {
      variant = Cc["@mozilla.org/variant;1"]
                    .createInstance(Ci.nsIWritableVariant);
      variant.setFromVariant(aArg2);
      argsArray.appendElement(variant, false);
    }

    return argsArray;
  },

  _getpid: function()
  {
    // Use nsIXULRuntime.processID if it is available.
    var pid = 0;

    try
    {
      var xreSvc = Cc["@mozilla.org/xre/app-info;1"]
                     .getService(Ci.nsIXULRuntime);
      pid = xreSvc.processID;
    }
    catch (e)
    {
      TorLauncherLogger.safelog(2, "failed to get process ID via XUL runtime:",
                                e);
    }

    // Try libc.getpid() via js-ctypes.
    if (!pid) try
    {
      var getpid;
      if (TorLauncherUtil.isMac)
      {
        var libc = ctypes.open("libc.dylib");
        getpid = libc.declare("getpid", ctypes.default_abi, ctypes.uint32_t);
      }
      else if (TorLauncherUtil.isWindows)
      {
        var libc = ctypes.open("Kernel32.dll");
        getpid = libc.declare("GetCurrentProcessId", ctypes.default_abi,
                              ctypes.uint32_t);
      }
      else // Linux and others.
      {
        var libc;
        try
        {
          libc = ctypes.open("libc.so.6");
        }
        catch(e)
        {
          libc = ctypes.open("libc.so");
        }

        getpid = libc.declare("getpid", ctypes.default_abi, ctypes.int);
      }

      pid = getpid();
    }
    catch(e)
    {
      TorLauncherLogger.safelog(4, "unable to get process ID: ", e);
    }

    return pid;
  },

  endOfObject: true
};


var gTorProcessService = new TorProcessService;


// TODO: Mark wants to research use of XPCOMUtils.generateNSGetFactory
// Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
function NSGetFactory(aClassID)
{
  if (!aClassID.equals(gTorProcessService.kClassID))
    throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;

  return gTorProcessService;
}
