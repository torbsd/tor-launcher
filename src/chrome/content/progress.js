// Copyright (c) 2013, The Tor Project, Inc.
// See LICENSE for licensing information.
//
// vim: set sw=2 sts=2 ts=8 et syntax=javascript:

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const kBootstrapStatusTopic = "TorBootstrapStatus";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherUtil",
                          "resource://torlauncher/modules/tl-util.jsm");

var gObsSvc;
var gOpenerCallbackFunc; // Set when opened from network settings.


function initDialog()
{
  try
  {
    gObsSvc = Cc["@mozilla.org/observer-service;1"]
                  .getService(Ci.nsIObserverService);
    gObsSvc.addObserver(BootstrapStatusObserver, kBootstrapStatusTopic, false);
  }
  catch (e) {}

  if (window.arguments)
    gOpenerCallbackFunc = window.arguments[0];

  // If this dialog was not opened from network settings, change Cancel to Quit.
  if (!gOpenerCallbackFunc)
  {
    var cancelBtn = document.documentElement.getButton("cancel");
    var quitKey = (TorLauncherUtil.isWindows) ? "quit_win" : "quit";
    cancelBtn.label = TorLauncherUtil.getLocalizedString(quitKey);
  }
}


function cleanup()
{
  if (gObsSvc)
    gObsSvc.removeObserver(BootstrapStatusObserver, kBootstrapStatusTopic);
}


function closeThisWindow(aBootstrapDidComplete)
{
  cleanup();

  if (gOpenerCallbackFunc)
    gOpenerCallbackFunc(aBootstrapDidComplete);

  window.close();
}


function onCancel()
{
  cleanup();

  if (gOpenerCallbackFunc)
  {
    // TODO: stop the bootstrapping process?
    gOpenerCallbackFunc(false);
  }
  else try
  {
    var obsSvc = Cc["@mozilla.org/observer-service;1"]
                   .getService(Ci.nsIObserverService);
    obsSvc.notifyObservers(null, "TorUserRequestedQuit", null);
  } catch (e) {}

  return true;
}


var BootstrapStatusObserver = {
  // nsIObserver implementation.
  observe: function(aSubject, aTopic, aParam)
  {
    if (kBootstrapStatusTopic == aTopic)
    {
      var statusObj = aSubject.wrappedJSObject;
      var labelText = (statusObj.SUMMARY) ? statusObj.SUMMARY : "";
      var percentComplete = (statusObj.PROGRESS) ? statusObj.PROGRESS : 0;

      var desc = document.getElementById("progressDesc");
      if (desc)
        desc.textContent = labelText;
      var meter = document.getElementById("progressMeter");
      if (meter)
        meter.value = percentComplete;

      var bootstrapDidComplete = (percentComplete >= 100);
      if (percentComplete >= 100)
      {
        // To ensure that 100% progress is displayed, wait a short while
        // before closing this window.
        window.setTimeout(function() { closeThisWindow(true); }, 250);
      }
      else if (statusObj._errorOccurred)
        closeThisWindow(false);
    }
  },
};
