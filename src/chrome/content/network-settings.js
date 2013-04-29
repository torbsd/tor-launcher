// Copyright (c) 2013, The Tor Project, Inc.
// See LICENSE for licensing information.
//
// vim: set sw=2 sts=2 ts=8 et syntax=javascript:

// TODO: if clean start and "Unable to read Tor settings" error is displayed, we should not bootstrap Tor or start the browser.

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherUtil",
                          "resource://torlauncher/modules/tl-util.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherLogger",
                          "resource://torlauncher/modules/tl-logger.jsm");


const kSupportAddr = "help@rt.torproject.org";

const kTorProcessReadyTopic = "TorProcessIsReady";
const kTorProcessExitedTopic = "TorProcessExited";
const kTorProcessDidNotStartTopic = "TorProcessDidNotStart";
const kTorBootstrapErrorTopic = "TorBootstrapError";

const kWizardProxyRadioGroup = "proxyRadioGroup";
const kWizardFirewallRadioGroup = "firewallRadioGroup";

const kUseProxyCheckbox = "useProxy";
const kProxyTypeMenulist = "proxyType";
const kProxyAddr = "proxyAddr";
const kProxyPort = "proxyPort";
const kProxyUsername = "proxyUsername";
const kProxyPassword = "proxyPassword";
const kUseFirewallPortsCheckbox = "useFirewallPorts";
const kFirewallAllowedPorts = "firewallAllowedPorts";
const kUseBridgesCheckbox = "useBridges";
const kBridgeList = "bridgeList";

const kTorConfKeyDisableNetwork = "DisableNetwork";
const kTorConfKeySocks4Proxy = "Socks4Proxy";
const kTorConfKeySocks5Proxy = "Socks5Proxy";
const kTorConfKeySocks5ProxyUsername = "Socks5ProxyUsername";
const kTorConfKeySocks5ProxyPassword = "Socks5ProxyPassword";
const kTorConfKeyHTTPSProxy = "HTTPSProxy";
const kTorConfKeyHTTPSProxyAuthenticator = "HTTPSProxyAuthenticator";
const kTorConfKeyReachableAddresses = "ReachableAddresses";
const kTorConfKeyUseBridges = "UseBridges";
const kTorConfKeyBridgeList = "Bridge";

var gProtocolSvc = null;
var gTorProcessService = null;
var gObsService = null;
var gIsInitialBootstrap = false;
var gIsBootstrapComplete = false;
var gRestoreAfterHelpPanelID = null;


function initDialog()
{
  var forAssistance = document.getElementById("forAssistance");
  if (forAssistance)
  {
    forAssistance.textContent = TorLauncherUtil.getFormattedLocalizedString(
                                        "forAssistance", [kSupportAddr], 1);
  }

  var cancelBtn = document.documentElement.getButton("cancel");
  gIsInitialBootstrap = window.arguments[0];
  if (gIsInitialBootstrap)
  {
    if (cancelBtn)
    {
      var quitKey = (TorLauncherUtil.isWindows) ? "quit_win" : "quit";
      cancelBtn.label = TorLauncherUtil.getLocalizedString(quitKey);
    }

    var okBtn = document.documentElement.getButton("accept");
    if (okBtn)
      okBtn.label = TorLauncherUtil.getLocalizedString("connect");
  }

  try
  {
    var svc = Cc["@torproject.org/torlauncher-protocol-service;1"]
                .getService(Ci.nsISupports);
    gProtocolSvc = svc.wrappedJSObject;
  }
  catch (e) { dump(e + "\n"); }

  try
  {
    var svc = Cc["@torproject.org/torlauncher-process-service;1"]
                .getService(Ci.nsISupports);
    gTorProcessService = svc.wrappedJSObject;
  }
  catch (e) { dump(e + "\n"); }

  gObsService = Cc["@mozilla.org/observer-service;1"]
                  .getService(Ci.nsIObserverService);

  var wizardElem = getWizard();
  var haveWizard = (wizardElem != null);
  if (haveWizard)
  {
    // Set "Copy Tor Log" label and move it after the Quit (cancel) button.
    var copyLogBtn = document.documentElement.getButton("extra1");
    if (copyLogBtn)
    {
      copyLogBtn.label = wizardElem.getAttribute("buttonlabelextra1");
      if (cancelBtn && !TorLauncherUtil.isWindows)
        cancelBtn.parentNode.insertBefore(copyLogBtn, cancelBtn.nextSibling);
    }

    // Use "Connect" as the finish button label (on the last wizard page)..
    var finishBtn = document.documentElement.getButton("finish");
    if (finishBtn)
      finishBtn.label = TorLauncherUtil.getLocalizedString("connect");
  }

  gObsService.addObserver(gObserver, kTorBootstrapErrorTopic, false);

  if (TorLauncherUtil.shouldStartAndOwnTor &&
      !gTorProcessService.TorIsProcessReady)
  {
    showPanel("startingTor");
    if (haveWizard)
    {
      showOrHideButton("back", false, false);
      showOrHideButton("next", false, false);
    }

    gObsService.addObserver(gObserver, kTorProcessReadyTopic, false);
    gObsService.addObserver(gObserver, kTorProcessExitedTopic, false);
    gObsService.addObserver(gObserver, kTorProcessDidNotStartTopic, false);
  }
  else
  {
    showPanel("settings");
    readTorSettings();
  }

  TorLauncherLogger.log(2, "initDialog done");
}


function getWizard()
{
  var elem = document.getElementById("TorNetworkSettings");
  return (elem && (elem.tagName == "wizard")) ? elem : null;
}


function onWizardProxyNext(aWizPage)
{
  if (aWizPage)
  {
    var hasProxy = getElemValue("proxyRadioYes", false);
    aWizPage.next = (hasProxy) ? "proxyYES" : "firewall";
  }

  return true;
}


function onWizardFirewallNext(aWizPage)
{
  if (aWizPage)
  {
    var hasFirewall = getElemValue("firewallRadioYes", false);
    aWizPage.next = (hasFirewall) ? "firewallYES" : "bridges";
  }

  return true;
}


var gObserver = {
  observe: function(aSubject, aTopic, aData)
  {
    if (kTorBootstrapErrorTopic == aTopic)
    {
      wizardShowCopyLogButton();
      return;
    }

    // Process events that only occur once.
    gObsService.removeObserver(gObserver, kTorProcessReadyTopic);
    gObsService.removeObserver(gObserver, kTorProcessExitedTopic);
    gObsService.removeObserver(gObserver, kTorProcessDidNotStartTopic);

    if (kTorProcessReadyTopic == aTopic)
    {
      var haveWizard = (getWizard() != null);
      showPanel(haveWizard ? "proxy" : "settings");
      if (haveWizard)
      {
        showOrHideButton("back", true, false);
        showOrHideButton("next", true, false);
      }
      readTorSettings();
    }
    else if (kTorProcessDidNotStartTopic == aTopic)
      showErrorPanel();
    else // kTorProcessExitedTopic
      close();
  }
};


function readTorSettings()
{
  TorLauncherLogger.log(2, "readTorSettings " +
                            "----------------------------------------------");

  var didSucceed = false;
  try
  {
    // TODO: retrieve > 1 key at one time inside initProxySettings() et al.
    didSucceed = initProxySettings() && initFirewallSettings() &&
                 initBridgeSettings();
  }
  catch (e) { TorLauncherLogger.safelog(4, "Error in readTorSettings: ", e); }

  if (!didSucceed)
  {
    // Unable to communicate with tor.  Hide settings and display an error.
    showErrorPanel();

    setTimeout(function()
        {
          var details = TorLauncherUtil.getLocalizedString(
                                          "ensure_tor_is_running");
          var s = TorLauncherUtil.getFormattedLocalizedString(
                                      "failed_to_get_settings", [details], 1);
          TorLauncherUtil.showAlert(window, s);
          close();
        }, 0);
  }
  TorLauncherLogger.log(2, "readTorSettings done");
}


function showPanel(aPanelID)
{
  var deckElem = document.getElementById("deck");
  if (deckElem)
  {
    deckElem.selectedPanel = document.getElementById(aPanelID);
    showOrHideButton("extra1", (aPanelID != "bridgeHelp"), false);
  }
  else
    getWizard().goTo(aPanelID);

  showOrHideButton("accept", (aPanelID == "settings"), true);
}


function showErrorPanel()
{
    showPanel("errorPanel");
    wizardShowCopyLogButton();
}


function wizardShowCopyLogButton()
{
  if (getWizard())
  {
    var copyLogBtn = document.documentElement.getButton("extra1");
    if (copyLogBtn)
    {
      copyLogBtn.setAttribute("wizardCanCopyLog", true);
      copyLogBtn.removeAttribute("hidden");
    }
  }
}


function showOrHideButton(aID, aShow, aFocus)
{
  var btn = setButtonAttr(aID, "hidden", !aShow);
  if (btn && aFocus)
    btn.focus()
}


// Returns the button element (if found).
function enableButton(aID, aEnable)
{
  return setButtonAttr(aID, "disabled", !aEnable);
}


// Returns the button element (if found).
function setButtonAttr(aID, aAttr, aValue)
{
  if (!aID || !aAttr)
    return null;

  var btn = document.documentElement.getButton(aID);
  if (btn)
  {
    if (aValue)
      btn.setAttribute(aAttr, aValue);
    else
      btn.removeAttribute(aAttr);
  }

  return btn;
}


function overrideButtonLabel(aID, aLabelKey)
{
  var btn = document.documentElement.getButton(aID);
  if (btn)
  {
    btn.setAttribute("origLabel", btn.label);
    btn.label = TorLauncherUtil.getLocalizedString(aLabelKey);
  }
}


function restoreButtonLabel(aID)
{
  var btn = document.documentElement.getButton(aID);
  if (btn)
  {
    var oldLabel = btn.getAttribute("origLabel");
    if (oldLabel)
    {
      btn.label = oldLabel;
      btn.removeAttribute("origLabel");
    }
  }
}


function onCancel()
{
  if (gRestoreAfterHelpPanelID) // Is help open?
  {
    closeHelp();
    return false;
  }

  if (gIsInitialBootstrap) try
  {
    var obsSvc = Cc["@mozilla.org/observer-service;1"]
                   .getService(Ci.nsIObserverService);
    obsSvc.notifyObservers(null, "TorUserRequestedQuit", null);
  } catch (e) {}

  return true;
}


function onCopyLog()
{
  var chSvc = Cc["@mozilla.org/widget/clipboardhelper;1"]
                             .getService(Ci.nsIClipboardHelper);
  chSvc.copyString(gProtocolSvc.TorGetLog());
}


function onOpenHelp()
{
  if (gRestoreAfterHelpPanelID) // Already open?
    return;

  var deckElem = document.getElementById("deck");
  if (deckElem)
    gRestoreAfterHelpPanelID = deckElem.selectedPanel.id;
  else
    gRestoreAfterHelpPanelID = getWizard().currentPage.pageid;

  if (getWizard())
  {
    showOrHideButton("cancel", false, false);
    showOrHideButton("back", false, false);
    showOrHideButton("extra1", false, false);
    overrideButtonLabel("next", "done");
  }
  else
    overrideButtonLabel("cancel", "done");

  showPanel("bridgeHelp");
}


function closeHelp()
{
  if (!gRestoreAfterHelpPanelID)  // Already closed?
    return;

  if (getWizard())
  {
    showOrHideButton("cancel", true, false);
    showOrHideButton("back", true, false);
    var copyLogBtn = document.documentElement.getButton("extra1");
    if (copyLogBtn && copyLogBtn.hasAttribute("wizardCanCopyLog"))
      copyLogBtn.removeAttribute("hidden");
    restoreButtonLabel("next");
  }
  else
    restoreButtonLabel("cancel");

  showPanel(gRestoreAfterHelpPanelID);
  gRestoreAfterHelpPanelID = null;
}


// Returns true if successful.
function initProxySettings()
{
  var proxyType, proxyAddrPort, proxyUsername, proxyPassword;
  var reply = gProtocolSvc.TorGetConfStr(kTorConfKeySocks4Proxy, null);
  if (!gProtocolSvc.TorCommandSucceeded(reply))
    return false;

  if (reply.retVal)
  {
    proxyType = "SOCKS4";
    proxyAddrPort = reply.retVal;
    // TODO: disable user and password fields.
  }
  else
  {
    var reply = gProtocolSvc.TorGetConfStr(kTorConfKeySocks5Proxy, null);
    if (!gProtocolSvc.TorCommandSucceeded(reply))
      return false;

    if (reply.retVal)
    {
      proxyType = "SOCKS5";
      proxyAddrPort = reply.retVal;
      var reply = gProtocolSvc.TorGetConfStr(kTorConfKeySocks5ProxyUsername,
                                             null);
      if (!gProtocolSvc.TorCommandSucceeded(reply))
        return false;

      proxyUsername = reply.retVal;
      var reply = gProtocolSvc.TorGetConfStr(kTorConfKeySocks5ProxyPassword,
                                             null);
      if (!gProtocolSvc.TorCommandSucceeded(reply))
        return false;

      proxyPassword = reply.retVal;
    }
    else
    {
      var reply = gProtocolSvc.TorGetConfStr(kTorConfKeyHTTPSProxy, null);
      if (!gProtocolSvc.TorCommandSucceeded(reply))
        return false;

      if (reply.retVal)
      {
        proxyType = "HTTP";
        proxyAddrPort = reply.retVal;
        var reply = gProtocolSvc.TorGetConfStr(
                                   kTorConfKeyHTTPSProxyAuthenticator, null);
        if (!gProtocolSvc.TorCommandSucceeded(reply))
          return false;

        var values = parseColonStr(reply.retVal);
        proxyUsername = values[0];
        proxyPassword = values[1];
      }
    }
  }

  var haveProxy = (proxyType != undefined);
  setYesNoRadioValue(kWizardProxyRadioGroup, haveProxy);
  setElemValue(kUseProxyCheckbox, haveProxy);
  setElemValue(kProxyTypeMenulist, proxyType);

  var proxyAddr, proxyPort;
  if (proxyAddrPort)
  {
    var values = parseColonStr(proxyAddrPort);
    proxyAddr = values[0];
    proxyPort = values[1];
  }

  setElemValue(kProxyAddr, proxyAddr);
  setElemValue(kProxyPort, proxyPort);
  setElemValue(kProxyUsername, proxyUsername);
  setElemValue(kProxyPassword, proxyPassword);

  return true;
} // initProxySettings


// Returns true if successful.
function initFirewallSettings()
{
  var allowedPorts;
  var reply = gProtocolSvc.TorGetConfStr(kTorConfKeyReachableAddresses, null);
  if (!gProtocolSvc.TorCommandSucceeded(reply))
    return false;

  if (reply.retVal)
  {
    var portStrArray = reply.retVal.split(',');
    for (var i = 0; i < portStrArray.length; i++)
    {
      var values = parseColonStr(portStrArray[i]);
      if (values[1])
      {
        if (allowedPorts)
          allowedPorts += ',' + values[1];
        else
          allowedPorts = values[1];
      }
    }
  }

  var haveFirewall = (allowedPorts != undefined);
  setYesNoRadioValue(kWizardFirewallRadioGroup, haveFirewall);
  setElemValue(kUseFirewallPortsCheckbox, haveFirewall);
  if (allowedPorts)
    setElemValue(kFirewallAllowedPorts, allowedPorts);

  return true;
}


// Returns true if successful.
function initBridgeSettings()
{
  var reply = gProtocolSvc.TorGetConfBool(kTorConfKeyUseBridges, false);
  if (!gProtocolSvc.TorCommandSucceeded(reply))
    return false;

  setElemValue(kUseBridgesCheckbox, reply.retVal);

  var bridgeReply = gProtocolSvc.TorGetConf(kTorConfKeyBridgeList);
  if (!gProtocolSvc.TorCommandSucceeded(bridgeReply))
    return false;

  setElemValue(kBridgeList, bridgeReply.lineArray);

  return true;
}


// Returns true if settings were successfully applied.
function applySettings()
{
  TorLauncherLogger.log(2, "applySettings ---------------------" +
                             "----------------------------------------------");
  var didSucceed = false;
  try
  {
    didSucceed = applyProxySettings() && applyFirewallSettings() &&
                 applyBridgeSettings();
  }
  catch (e) { TorLauncherLogger.safelog(4, "Error in applySettings: ", e); }

  if (didSucceed)
  {
    var settings = {};
    settings[kTorConfKeyDisableNetwork] = "0";
    this.setConfAndReportErrors(settings);

    gProtocolSvc.TorSendCommand("SAVECONF");
    gTorProcessService.TorClearBootstrapError();

    gIsBootstrapComplete = gTorProcessService.TorIsBootstrapDone;
    if (!gIsBootstrapComplete)
      openProgressDialog();

    if (gIsBootstrapComplete)
      close();
  }

  TorLauncherLogger.log(2, "applySettings done");

  return false;
}


function openProgressDialog()
{
  var chromeURL = "chrome://torlauncher/content/progress.xul";
  var features = "chrome,dialog=yes,modal=yes,dependent=yes";
  window.openDialog(chromeURL, "_blank", features,
                    gIsInitialBootstrap, onProgressDialogClose);
}


function onProgressDialogClose(aBootstrapCompleted)
{
  gIsBootstrapComplete = aBootstrapCompleted;
}


// Returns true if settings were successfully applied.
function applyProxySettings()
{
  var settings = getAndValidateProxySettings();
  if (!settings)
    return false;

  return this.setConfAndReportErrors(settings);
}


// Return a settings object if successful and null if not.
function getAndValidateProxySettings()
{
  // TODO: validate user-entered data.  See Vidalia's NetworkPage::save()

  var settings = {};
  settings[kTorConfKeySocks4Proxy] = null;
  settings[kTorConfKeySocks5Proxy] = null;
  settings[kTorConfKeySocks5ProxyUsername] = null;
  settings[kTorConfKeySocks5ProxyPassword] = null;
  settings[kTorConfKeyHTTPSProxy] = null;
  settings[kTorConfKeyHTTPSProxyAuthenticator] = null;

  var proxyType, proxyAddrPort, proxyUsername, proxyPassword;
  var useProxy = (getWizard()) ? getYesNoRadioValue(kWizardProxyRadioGroup)
                               : getElemValue(kUseProxyCheckbox, false);
  if (useProxy)
  {
    proxyAddrPort = createColonStr(getElemValue(kProxyAddr, null),
                                   getElemValue(kProxyPort, null));
    if (!proxyAddrPort)
    {
      reportValidationError("error_proxy_addr_missing");
      return null;
    }

    proxyType = getElemValue(kProxyTypeMenulist, null);
    if (!proxyType)
    {
      reportValidationError("error_proxy_type_missing");
      return null;
    }

    if ("SOCKS4" != proxyType)
    {
      proxyUsername = getElemValue(kProxyUsername);
      proxyPassword = getElemValue(kProxyPassword);
    }
  }

  if ("SOCKS4" == proxyType)
  {
    settings[kTorConfKeySocks4Proxy] = proxyAddrPort;
  }
  else if ("SOCKS5" == proxyType)
  {
    settings[kTorConfKeySocks5Proxy] = proxyAddrPort;
    settings[kTorConfKeySocks5ProxyUsername] = proxyUsername;
    settings[kTorConfKeySocks5ProxyPassword] = proxyPassword;
  }
  else if ("HTTP" == proxyType)
  {
    settings[kTorConfKeyHTTPSProxy] = proxyAddrPort;
    // TODO: Does any escaping need to be done?
    settings[kTorConfKeyHTTPSProxyAuthenticator] =
                                  createColonStr(proxyUsername, proxyPassword);
  }

  return settings;
} // applyProxySettings


function reportValidationError(aStrKey)
{
  showSaveSettingsAlert(TorLauncherUtil.getLocalizedString(aStrKey));
}


// Returns true if settings were successfully applied.
function applyFirewallSettings()
{
  var settings = getAndValidateFirewallSettings();
  if (!settings)
    return false;

  return this.setConfAndReportErrors(settings);
}


// Return a settings object if successful and null if not.
function getAndValidateFirewallSettings()
{
  // TODO: validate user-entered data.  See Vidalia's NetworkPage::save()

  var settings = {};
  settings[kTorConfKeyReachableAddresses] = null;

  var useFirewallPorts = (getWizard())
                            ? getYesNoRadioValue(kWizardFirewallRadioGroup)
                            : getElemValue(kUseFirewallPortsCheckbox, false);
  var allowedPorts = getElemValue(kFirewallAllowedPorts, null);
  if (useFirewallPorts && allowedPorts)
  {
    var portsConfStr;
    var portsArray = allowedPorts.split(',');
    for (var i = 0; i < portsArray.length; ++i)
    {
      var s = portsArray[i].trim();
      if (s.length > 0)
      {
        if (!portsConfStr)
          portsConfStr = "*:" + s;
        else
          portsConfStr += ",*:" + s;
      }
    }

    if (portsConfStr)
      settings[kTorConfKeyReachableAddresses] = portsConfStr;
  }

  return settings;
}


// Returns true if settings were successfully applied.
function applyBridgeSettings()
{
  var settings = getAndValidateBridgeSettings();
  if (!settings)
    return false;

  return this.setConfAndReportErrors(settings);
}


// Return a settings object if successful and null if not.
function getAndValidateBridgeSettings()
{
  var settings = {};
  settings[kTorConfKeyUseBridges] = null;
  settings[kTorConfKeyBridgeList] = null;

  var bridgeStr = getElemValue(kBridgeList, null);
  var useBridges = (getWizard()) ? (bridgeStr && (0 != bridgeStr.length))
                                  : getElemValue(kUseBridgesCheckbox, false);

  var bridgeList = parseAndValidateBridges(bridgeStr);
  if (useBridges && !bridgeList)
  {
    reportValidationError("error_bridges_missing");
    return null;
  }

  setElemValue(kBridgeList, bridgeList);
  if (useBridges && bridgeList)
  {
    settings[kTorConfKeyUseBridges] = true;
    settings[kTorConfKeyBridgeList] = bridgeList;
  }

  return settings;
}


// Returns an array or null.
function parseAndValidateBridges(aStr)
{
  if (!aStr)
    return null;

  var resultStr = aStr;
  resultStr = resultStr.replace(/bridge/gi, ""); // Remove "bridge" everywhere.
  resultStr = resultStr.replace(/\r\n/g, "\n");  // Convert \r\n pairs into \n.
  resultStr = resultStr.replace(/\r/g, "\n");    // Convert \r into \n.
  resultStr = resultStr.replace(/\n\n/g, "\n");  // Condense blank lines.

  var resultArray = new Array;
  var tmpArray = resultStr.split('\n');
  for (var i = 0; i < tmpArray.length; i++)
  {
    let s = tmpArray[i].trim(); // Remove extraneous whitespace.
    if (s.indexOf(' ') >= 0)
    {
      // Handle a space-separated list of bridge specs.
      var tmpArray2 = s.split(' ');
      for (var j = 0; j < tmpArray2.length; ++j)
      {
        let s2 = tmpArray2[j];
        if (s2.length > 0)
          resultArray.push(s2);
      }
    }
    else if (s.length > 0)
      resultArray.push(s);
  }

  return (0 == resultArray.length) ? null : resultArray;
}


// Returns true if successful.
function setConfAndReportErrors(aSettingsObj)
{
  var reply = gProtocolSvc.TorSetConf(aSettingsObj);
  var didSucceed = gProtocolSvc.TorCommandSucceeded(reply);
  if (!didSucceed)
  {
    var details = "";
    if (reply && reply.lineArray)
    {
      for (var i = 0; i < reply.lineArray.length; ++i)
      {
        if (i > 0)
          details += '\n';
        details += reply.lineArray[i];
      }
    }

    showSaveSettingsAlert(details);
  }

  return didSucceed;
}


function showSaveSettingsAlert(aDetails)
{
  if (!aDetails)
     aDetails = TorLauncherUtil.getLocalizedString("ensure_tor_is_running");

  var s = TorLauncherUtil.getFormattedLocalizedString(
                                  "failed_to_save_settings", [aDetails], 1);
  TorLauncherUtil.showAlert(window, s);

  showOrHideButton("extra1", true, false);
  gWizIsCopyLogBtnShowing = true;
}


function setElemValue(aID, aValue)
{
  var elem = document.getElementById(aID);
  if (elem)
  {
    switch (elem.tagName)
    {
      case "checkbox":
        elem.checked = aValue;
        toggleElemUI(elem);
        break;
      case "textbox":
        var s = aValue;
        if (Array.isArray(aValue))
        {
          s = "";
          for (var i = 0; i < aValue.length; ++i)
          {
            if (s.length > 0)
              s += '\n';
            s += aValue[i];
          }
        }
        // fallthru
      case "menulist":
        elem.value = (s) ? s : "";
        break;
    }
  }
}


// Returns a Boolean (for checkboxes/radio buttons) or a
// string (textbox and menulist).
// Leading and trailing white space is trimmed from strings.
function getElemValue(aID, aDefaultValue)
{
  var rv = aDefaultValue;
  var elem = document.getElementById(aID);
  if (elem)
  {
    switch (elem.tagName)
    {
      case "checkbox":
        rv = elem.checked;
        break;
      case "radio":
        rv = elem.selected;
        break;
      case "textbox":
      case "menulist":
        rv = elem.value;
        break;
    }
  }

  if (rv && ("string" == (typeof rv)))
    rv = rv.trim();

  return rv;
}


// This assumes that first radio button is yes.
function setYesNoRadioValue(aGroupID, aIsYes)
{
  var elem = document.getElementById(aGroupID);
  if (elem)
    elem.selectedIndex = (aIsYes) ? 0 : 1;
}


// This assumes that first radio button is yes.
function getYesNoRadioValue(aGroupID)
{
  var elem = document.getElementById(aGroupID);
  return (elem) ? (0 == elem.selectedIndex) : false;
}


function toggleElemUI(aElem)
{
  if (!aElem)
    return;

  var gbID = aElem.getAttribute("groupboxID");
  if (gbID)
  {
    var gb = document.getElementById(gbID);
    if (gb)
      gb.hidden = !aElem.checked;
  }
}


// Separate aStr at the first colon.  Always return a two-element array.
function parseColonStr(aStr)
{
  var rv = ["", ""];
  if (!aStr)
    return rv;

  var idx = aStr.indexOf(":");
  if (idx >= 0)
  {
    if (idx > 0)
      rv[0] = aStr.substring(0, idx);
    rv[1] = aStr.substring(idx + 1);
  }
  else
    rv[0] = aStr;

  return rv;
}


function createColonStr(aStr1, aStr2)
{
  var rv = aStr1;
  if (aStr2)
  {
    if (!rv)
      rv = "";
    rv += ':' + aStr2;
  }

  return rv;
}
