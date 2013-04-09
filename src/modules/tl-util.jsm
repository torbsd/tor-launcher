// Copyright (c) 2013, The Tor Project, Inc.
// See LICENSE for licensing information.
//
// vim: set sw=2 sts=2 ts=8 et syntax=javascript:

/*************************************************************************
 * Tor Launcher Util JS Module
 *************************************************************************/

let EXPORTED_SYMBOLS = [ "TorLauncherUtil" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const kPropBundleURI = "chrome://torlauncher/locale/torlauncher.properties";
const kPropNamePrefix = "torlauncher.";

let TorLauncherUtil =  // Public
{
  get isMac()
  {
    return ("Darwin" == TLUtilInternal._OS);
  },

  get isWindows()
  {
    return ("WINNT" == TLUtilInternal._OS);
  },

  // Error Reporting / Prompting
  showAlert: function(aParentWindow, aMsg)
  {
    // TODO: alert() does not always resize correctly to fit the message.
    try
    {
      if (!aParentWindow)
      {
        var wm = Cc["@mozilla.org/appshell/window-mediator;1"]
                   .getService(Ci.nsIWindowMediator);
        aParentWindow = wm.getMostRecentWindow("navigator:browser");
      }

      var ps = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                 .getService(Ci.nsIPromptService);
      var title = this.getLocalizedString("error_title");
      ps.alert(aParentWindow, title, aMsg);
    }
    catch (e)
    {
      alert(aMsg);
    }
  },

  // Localized Strings

  // "torlauncher." is prepended to aStringName.
  getLocalizedString: function(aStringName)
  {
    if (!aStringName)
      return aStringName;

    try
    {
      var key = kPropNamePrefix + aStringName;
      return TLUtilInternal._stringBundle.GetStringFromName(key);
    } catch(e) {}

    return aStringName;
  },

  // "torlauncher." is prepended to aStringName.
  getFormattedLocalizedString: function(aStringName, aArray, aLen)
  {
    if (!aStringName || !aArray)
      return aStringName;

    try
    {
      var key = kPropNamePrefix + aStringName;
      return TLUtilInternal._stringBundle.formatStringFromName(key,
                                                               aArray, aLen);
    } catch(e) {}

    return aStringName;
  },

  // Preferences
  getBoolPref: function(aPrefName, aDefaultVal)
  {
    var rv = (undefined != aDefaultVal) ? aDefaultVal : false;

    try
    {
      rv = TLUtilInternal.mPrefsSvc.getBoolPref(aPrefName);
    } catch (e) {}

    return rv;
  },

  setBoolPref: function(aPrefName, aVal)
  {
    var val = (undefined != aVal) ? aVal : false;
    try
    {
      TLUtilInternal.mPrefsSvc.setBoolPref(aPrefName, val);
    } catch (e) {}
  },

  getIntPref: function(aPrefName, aDefaultVal)
  {
    var rv = aDefaultVal ? aDefaultVal : 0;

    try
    {
      rv = TLUtilInternal.mPrefsSvc.getIntPref(aPrefName);
    } catch (e) {}

    return rv;
  },

  getCharPref: function(aPrefName, aDefaultVal)
  {
    var rv = aDefaultVal ? aDefaultVal : "";

    try
    {
      rv = TLUtilInternal.mPrefsSvc.getCharPref(aPrefName);
    } catch (e) {}

    return rv;
  },
};


Object.freeze(TorLauncherUtil);


let TLUtilInternal =  // Private
{
  mPrefsSvc : null,
  mStringBundle : null,
  mOS : "",

  _init: function()
  {
    this.mPrefsSvc = Cc["@mozilla.org/preferences-service;1"]
                       .getService(Ci.nsIPrefBranch);
  },

  get _stringBundle()
  {
    if (!this.mStringBundle)
    {
      this.mStringBundle = Cc["@mozilla.org/intl/stringbundle;1"]
                             .getService(Ci.nsIStringBundleService)
                             .createBundle(kPropBundleURI);
    }

    return this.mStringBundle;
  },

  get _OS()
  {
    if (!this.mOS) try
    {
      var xr = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime);
      this.mOS = xr.OS;
    } catch (e) {}

    return this.mOS;
  },
};


TLUtilInternal._init();
