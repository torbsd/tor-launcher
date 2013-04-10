// Copyright (c) 2013, The Tor Project, Inc.
// See LICENSE for licensing information.
// TODO: Some code came from torbutton.js (pull in copyright and license?)
//
// vim: set sw=2 sts=2 ts=8 et syntax=javascript:

// Notes: decided to avoid IDL/xpt since it will complicate build process

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherUtil",
                          "resource://torlauncher/modules/tl-util.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherLogger",
                          "resource://torlauncher/modules/tl-logger.jsm");


function TorProtocolService()
{
  this.wrappedJSObject = this;

  try
  {
    var env = Cc["@mozilla.org/process/environment;1"]
                .getService(Ci.nsIEnvironment);

    if (env.exists("TOR_CONTROL_HOST"))
      this.mControlHost = env.get("TOR_CONTROL_HOST");
    else
    {
      this.mControlHost = TorLauncherUtil.getCharPref(
                        "extensions.torlauncher.control_host", "127.0.0.1");
    }

    if (env.exists("TOR_CONTROL_PORT"))
      this.mControlPort = parseInt(env.get("TOR_CONTROL_PORT"), 10);
    else
    {
      this.mControlPort = TorLauncherUtil.getIntPref(
                               "extensions.torlauncher.control_port", 9151);
    }

    // Populate mControlPassword so it is available when starting tor.
    if (env.exists("TOR_CONTROL_PASSWD"))
      this.mControlPassword = env.get("TOR_CONTROL_PASSWD");
    else if (env.exists("TOR_CONTROL_COOKIE_AUTH_FILE"))
    {
      // TODO: test this code path.
      var cookiePath = env.get("TOR_CONTROL_COOKIE_AUTH_FILE");
      if ("" != cookiePath)
        this.mControlPassword = this._read_authentication_cookie(cookiePath);
    }

    if (!this.mControlPassword)
      this.mControlPassword = this._generateRandomPassword();
  }
  catch(e)
  {
    TorLauncherLogger.log(4, "failed to get environment variables");
    return null;
  }
} // TorProtocolService constructor


TorProtocolService.prototype =
{
  kContractID : "@torproject.org/torlauncher-protocol-service;1",
  kServiceName : "Tor Launcher Protocol Service",
  kClassID: Components.ID("{4F476361-23FB-43EF-A427-B36A14D3208E}"),

  kPrefStartTor: "extensions.torlauncher.start_tor",

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

  // Public Constants and Methods ////////////////////////////////////////////
  kCmdStatusOK: 250,

  // Returns hashed Tor password string or null if an error occurs.
  TorGetHashedPassword: function()
  {
    return this._hashPassword(this.mControlPassword);
  },

  // NOTE: Many Tor protocol functions return a reply object, which is a
  // a JavaScript object that has the following fields:
  //   reply.statusCode  -- integer, e.g., 250
  //   reply.lineArray   -- an array of strings returned by tor
  // For GetConf calls, the aKey prefix is removed from the lineArray strings.

  // Perform a GETCONF command.
  // If a fatal error occurs, null is returned.  Otherwise, a reply object is
  // returned.
  TorGetConf: function(aKey)
  {
    if (!aKey || (aKey.length < 1))
      return null;

    var cmd = "GETCONF";
    var reply = this.TorSendCommand(cmd, aKey);
    if (!this.TorCommandSucceeded(reply))
      return reply;

    return this._parseReply(cmd, aKey, reply);
  },

  // Returns a reply object.  If the GETCONF command succeeded, reply.retVal
  // is set (if there is no setting for aKey, it is set to aDefault).
  TorGetConfStr: function(aKey, aDefault)
  {
    var reply = this.TorGetConf(aKey);
    if (this.TorCommandSucceeded(reply))
    {
      if (reply.lineArray.length > 0)
        reply.retVal = reply.lineArray[0];
      else
        reply.retVal = aDefault;
    }

    return reply;
  },

  // Returns a reply object.  If the GETCONF command succeeded, reply.retVal
  // is set (if there is no setting for aKey, it is set to aDefault).
  TorGetConfBool: function(aKey, aDefault)
  {
    var reply = this.TorGetConf(aKey);
    if (this.TorCommandSucceeded(reply))
    {
      if (reply.lineArray.length > 0)
        reply.retVal = ("1" == reply.lineArray[0]);
      else
        reply.retVal = aDefault;
    }

    return reply;
  },

  // Perform a SETCONF command.
  // aSettingsObj should be a JavaScript object with keys (property values)
  // that correspond to tor config. keys.  The value associated with each
  // key should be a simple string, a string array, or a Boolean value.
  // If a fatal error occurs, null is returned.  Otherwise, a reply object is
  // returned.
  TorSetConf: function(aSettingsObj)
  {
    if (!aSettingsObj)
      return null;

    var cmdArgs;
    for (var key in aSettingsObj)
    {
      if (!cmdArgs)
        cmdArgs = key;
      else
        cmdArgs += ' ' + key;
      var val = aSettingsObj[key];
      if (val)
      {
        var valType = (typeof val);
        if ("boolean" == valType)
          cmdArgs += '=' + ((val) ? '1' : '0');
        else if (Array.isArray(val))
        {
          for (var i = 0; i < val.length; ++i)
          {
            if (i > 0)
              cmdArgs += ' ' + key;
            cmdArgs += '=' + this._strEscape(val[i]);
          }
        }
        else if ("string" == valType)
          cmdArgs += '=' + this._strEscape(val);
        else
        {
          TorLauncherLogger.safelog(4, "TorSetConf: unsupported type '" +
                                         valType + "' for ", key);
          return null;
        }
      }
    }

    if (!cmdArgs)
    {
      TorLauncherLogger.log(4, "TorSetConf: no settings to set");
      return null;
    }

    return this.TorSendCommand("SETCONF", cmdArgs);
  }, // TorSetConf()

  // If successful, returns a JS object with these fields:
  //   status.TYPE            -- "NOTICE" or "WARN"
  //   status.PROGRESS        -- integer
  //   status.TAG             -- string
  //   status.SUMMARY         -- string
  //   status.WARNING         -- string (optional)
  //   status.REASON          -- string (optional)
  //   status.COUNT           -- integer (optional)
  //   status.RECOMMENDATION  -- string (optional)
  // Returns null upon failure.
  TorGetBootStrapStatus: function()
  {
    var cmd = "GETINFO";
    var key = "status/bootstrap-phase";
    var reply = this.TorSendCommand(cmd, key);
    if (!this.TorCommandSucceeded(reply))
    {
      TorLauncherLogger.log(4, "TorGetBootStrapStatus: command failed");
      return null;
    }

    // A typical reply looks like:
    //  250-status/bootstrap-phase=NOTICE BOOTSTRAP PROGRESS=100 TAG=done SUMMARY="Done"
    //  250 OK
    reply = this._parseReply(cmd, key, reply);
    if (reply.lineArray)
    {
      var sawBootstrap = false;
      var statusObj = {};
      statusObj.TYPE = "NOTICE";

      // The following code assumes that this is a one-line response.
      var paramArray = this._splitReplyLine(reply.lineArray[0]);
      for (var i = 0; i < paramArray.length; ++i)
      {
        var tokenAndVal = paramArray[i];
        var token, val;
        var idx = tokenAndVal.indexOf('=');
        if (idx < 0)
          token = tokenAndVal;
        else
        {
          token = tokenAndVal.substring(0, idx);
          var valObj = {};
          if (!this._strUnescape(tokenAndVal.substring(idx + 1), valObj))
            continue; // skip this token/value pair.

          val = valObj.result;
        }

        if ("BOOTSTRAP" == token)
          sawBootstrap = true;
        else if (("WARN" == token) || ("NOTICE" == token))
          statusObj.TYPE = token;
        else if (("COUNT" == token) || ("PROGRESS" == token))
          statusObj[token] = parseInt(val, 10);
        else
          statusObj[token] = val;
      }

      if (!sawBootstrap)
        TorLauncherLogger.log(4, "TorGetBootStrapStatus: missing BOOTSTRAP");
      else
        this._dumpObj("BootstrapStatus", statusObj); // TODO: remove this.
    }

    return statusObj;
  }, // TorGetBootStrapStatus()

  // Executes a command on the control port.
  // Return a reply object or null if a fatal error occurs.
  TorSendCommand: function(aCmd, aArgs)
  {
    var reply;
    for (var attempt = 0; !reply && (attempt < 2); ++attempt)
    {
      var conn;
      try
      {
        conn = this._getConnection();
        if (conn)
        {
          reply = this._sendCommand(conn, aCmd, aArgs)
          if (reply)
            this._returnConnection(conn); // Return for reuse.
          else
            this._closeConnection(conn);  // Connection is bad.
        }
      }
      catch(e)
      {
        TorLauncherLogger.log(4, "Exception on control port " + e);
        this._closeConnection(conn);
      }
    }

    return reply;
  }, // TorSendCommand()

  TorCommandSucceeded: function(aReply)
  {
    return !!(aReply && (this.kCmdStatusOK == aReply.statusCode));
  },

  // TorCleanupConnection() is called during browser shutdown.
  TorCleanupConnection: function()
  {
      this._closeConnection();
  },

  // Private Member Variables ////////////////////////////////////////////////
  mObsSvc: null,
  mControlPort: null,
  mControlHost: null,
  mControlPassword: null,     // JS string that contains hex-encoded password.
  mControlConnection: null,   // This is cached and reused.
  mCheckPasswordHash: false,  // set to true to perform a unit test

  // Private Methods /////////////////////////////////////////////////////////

  // Returns a JS object that contains these fields:
  //   inUse      // Boolean
  //   useCount   // Integer
  //   socket     // nsISocketTransport
  //   inStream   // nsIBinaryInputStream
  //   outStream  // nsIBinaryOutputStream
  _getConnection: function()
  {
    if (this.mControlConnection)
    {
      if (this.mControlConnection.inUse)
      {
        TorLauncherLogger.log(4, "control connection is in use");
        return null;
      }
    }
    else
      this.mControlConnection = this._openAuthenticatedConnection();


    if (this.mControlConnection)
      this.mControlConnection.inUse = true;

    return this.mControlConnection;
  },

  _returnConnection: function(aConn)
  {
    if (aConn && (aConn == this.mControlConnection))
      this.mControlConnection.inUse = false;
  },

  _openAuthenticatedConnection: function()
  {
    var conn;
    try
    {
      var sts = Cc["@mozilla.org/network/socket-transport-service;1"]
                  .getService(Ci.nsISocketTransportService);
      TorLauncherLogger.log(2, "Opening control connection to " +
                                 this.mControlHost + ":" + this.mControlPort);
      var socket = sts.createTransport(null, 0, this.mControlHost,
                                       this.mControlPort, null);
      const kFlags = socket.OPEN_BLOCKING | socket.OPEN_UNBUFFERED;
      var input = socket.openInputStream(kFlags, 0, 0);
      var output = socket.openOutputStream(kFlags, 0, 0);

      var inputStream  = Cc["@mozilla.org/binaryinputstream;1"]
                           .createInstance(Ci.nsIBinaryInputStream);
      var outputStream = Cc["@mozilla.org/binaryoutputstream;1"]
                           .createInstance(Ci.nsIBinaryOutputStream);
      inputStream.setInputStream(input);
      outputStream.setOutputStream(output);
      conn = { useCount: 0, socket: socket,
               inStream: inputStream, outStream: outputStream };

      // AUTHENTICATE
      var pwdArg = this._strEscape(this.mControlPassword);
      if (pwdArg && (pwdArg.length > 0) && (pwdArg.charAt(0) != '"'))
      {
        // Surround non-hex strings with double quotes.
        const kIsHexRE = /^[A-Fa-f0-9]*$/;
        if (!kIsHexRE.test(pwdArg))
          pwdArg = '"' + pwdArg + '"';
      }
      var reply = this._sendCommand(conn, "AUTHENTICATE", pwdArg);
      if (!this.TorCommandSucceeded(reply))
      {
        TorLauncherLogger.log(4, "authenticate failed");
        return null;
      }

      if (TorLauncherUtil.getBoolPref(this.kPrefStartTor))
      {
        // Try to become the primary controller (TAKEOWNERSHIP).
        reply = this._sendCommand(conn, "TAKEOWNERSHIP", null);
        if (!this.TorCommandSucceeded(reply))
          TorLauncherLogger.log(4, "take ownership failed");
        else
        {
          reply = this._sendCommand(conn, "RESETCONF",
                                    "__OwningControllerProcess");
          if (!this.TorCommandSucceeded(reply))
            TorLauncherLogger.log(4, "clear owning controller process failed");
        }
      }
    }
    catch(e)
    {
      TorLauncherLogger.safelog(4,
                             "failed to open authenticated connection: ", e);
      return null;
    }

    return conn;
  }, // _openAuthenticatedConnection()

  // If aConn is omitted, the cached connection is closed.
  _closeConnection: function(aConn)
  {
    if (!aConn)
      aConn = this.mControlConnection;

    if (aConn && aConn.socket)
      aConn.socket.close(0);

    if (aConn == this.mControlConnection)
      this.mControlConnection = null;
  },

  _sendCommand: function(aConn, aCmd, aArgs)
  {
    var reply;
    if (aConn)
    {
      var cmd = aCmd;
      if (aArgs)
        cmd += ' ' + aArgs;
      TorLauncherLogger.safelog(2, "Sending Tor command: ", cmd);
      cmd += "\r\n";

      ++aConn.useCount;
      aConn.outStream.writeBytes(cmd, cmd.length);
      reply = this._torReadReply(aConn.inStream);
    }

    return reply;
  },

  // Returns a reply object.
  _torReadReply: function(aInput)
  {
    var replyObj = {};
    replyObj.statusCode = 0;
    replyObj.lineArray = [];

    var sepChar = '';
    do
    {
      // TODO: handle + separators (data)
      var line = this._torReadLine(aInput);
      TorLauncherLogger.safelog(2, "Command response: ", line);
      if (line.length < 4)
      {
        TorLauncherLogger.safelog(4, "Unexpected response: ", line);
        return null;
      }

      replyObj.statusCode = parseInt(line.substr(0, 3), 10);
      sepChar = line.charAt(3);
      var s = (line.length < 5) ? "" : line.substr(4);
      if (s != "OK")  // Include all lines except simple "250 OK" ones.
        replyObj.lineArray.push(s);
    } while (sepChar != ' ');

    return replyObj;
  },

  _torReadLine: function(aInput)
  {
    var str = "";
    var bytes;
    while ((bytes = aInput.readBytes(1)) != "\n")
      str += bytes;

    var len = str.length;
    if ((len > 0) && ('\r' == str.substr(len - 1)))
      str = str.substr(0, len - 1);
    return str;
  },

  // _parseReply() understands simple GETCONF and GETINFO replies.
  _parseReply: function(aCmd, aKey, aReply)
  {
    if (!aCmd || !aKey || !aReply)
      return;

    var lcKey = aKey.toLowerCase();
    var prefix = lcKey + '=';
    var prefixLen = prefix.length;
    var tmpArray = [];
    for (var i = 0; i < aReply.lineArray.length; ++i)
    {
      var line = aReply.lineArray[i];
      var lcLine = line.toLowerCase();
      if (lcLine == lcKey)
        tmpArray.push("");
      else if (0 != lcLine.indexOf(prefix))
      {
        TorLauncherLogger.safelog(4, "Unexpected " + aCmd + " response: ",
                                    line);
      }
      else
      {
        var valObj = {};
        if (!this._strUnescape(line.substring(prefixLen), valObj))
        {
          TorLauncherLogger.safelog(4, "Invalid string within " + aCmd +
                                         " response: ", line);
        }
        else
          tmpArray.push(valObj.result);
      }
    }

    aReply.lineArray = tmpArray;
    return aReply;
  }, // _parseReply

  // Split aStr at spaces, accounting for quoted values.
  // Returns an array of strings.
  _splitReplyLine: function(aStr)
  {
    var rv = [];
    if (!aStr)
      return rv;

    var inQuotedStr = false;
    var val = "";
    for (var i = 0; i < aStr.length; ++i)
    {
      var c = aStr.charAt(i);
      if ((' ' == c) && !inQuotedStr)
      {
        rv.push(val);
        val = "";
      }
      else
      {
        if ('"' == c)
          inQuotedStr = !inQuotedStr;

        val += c;
      }
    }

    if (val.length > 0)
      rv.push(val);

    return rv;
  },

  // Escape non-ASCII characters for use within the Tor Control protocol.
  // Based on Vidalia's src/common/stringutil.cpp:string_escape().
  // Returns the new string.
  _strEscape: function(aStr)
  {
    // Just return if all characters are printable ASCII excluding SP and "
    const kSafeCharRE = /^[\x21\x23-\x7E]*$/;
    if (!aStr || kSafeCharRE.test(aStr))
      return aStr;

    var rv = '"';
    for (var i = 0; i < aStr.length; ++i)
    {
      var c = aStr.charAt(i);
      switch (c)
      {
        case '\"':
          rv += "\\\"";
          break;
        case '\\':
          rv += "\\\\";
          break;
        case '\n':
          rv += "\\n";
          break;
        case '\r':
          rv += "\\r";
          break;
        case '\t':
          rv += "\\t";
          break;
        default:
          var charCode = aStr.charCodeAt(i);
          if ((charCode >= 0x0020) && (charCode <= 0x007E))
            rv += c;
          else
          {
            // Generate \xHH encoded UTF-8.
            var utf8bytes = unescape(encodeURIComponent(c));
            for (var j = 0; j < utf8bytes.length; ++j)
              rv += "\\x" + this._toHex(utf8bytes.charCodeAt(j), 2);
          }
      }
    }

    rv += '"';
    return rv;
  }, // _strEscape()

  // Unescape Tor Control string aStr (removing surrounding "" and \ escapes).
  // Based on Vidalia's src/common/stringutil.cpp:string_unescape().
  // Returns true if successful and sets aResultObj.result.
  _strUnescape: function(aStr, aResultObj)
  {
    if (!aResultObj)
      return false;

    if (!aStr)
    {
      aResultObj.result = aStr;
      return true;
    }

    var len = aStr.length;
    if ((len < 2) || ('"' != aStr.charAt(0)) || ('"' != aStr.charAt(len - 1)))
    {
      aResultObj.result = aStr;
      return true;
    }

    var rv = "";
    var i = 1;
    var lastCharIndex = len - 2;
    while (i <= lastCharIndex)
    {
      var c = aStr.charAt(i);
      if ('\\' == c)
      {
        if (++i > lastCharIndex)
          return false; // error: \ without next character.

        c = aStr.charAt(i);
        if ('n' == c)
          rv += '\n';
        else if ('r' == c)
          rv += '\r';
        else if ('t' == c)
          rv += '\t';
        else if ('x' == c)
        {
          if ((i + 2) > lastCharIndex)
            return false; // error: not enough hex characters.

          var val = parseInt(aStr.substr(i, 2), 16);
          if (isNaN(val))
            return false; // error: invalid hex characters.

          rv += String.fromCharCode(val);
          i += 2;
        }
        else if (this._isDigit(c))
        {
          if ((i + 3) > lastCharIndex)
            return false; // error: not enough octal characters.

          var val = parseInt(aStr.substr(i, 3), 8);
          if (isNaN(val))
            return false; // error: invalid octal characters.

          rv += String.fromCharCode(val);
          i += 3;
        }
        else // "\\" and others
        {
          rv += c;
          ++i;
        }
      }
      else if ('"' == c)
        return false; // error: unescaped double quote in middle of string.
      else
      {
        rv += c;
        ++i;
      }
    }

    // Convert from UTF-8 to Unicode. TODO: is UTF-8 always used in protocol?
    rv = decodeURIComponent(escape(rv));

    aResultObj.result = rv;
    return true;
  }, // _strUnescape()

  // Returns a random 16 character password, hex-encoded.
  _generateRandomPassword: function()
  {
    if (this.mCheckPasswordHash)
      return "3322693f6e4f6b2a2536736b4429343f";

    // Similar to Vidalia's crypto_rand_string().
    const kPasswordLen = 16;
    const kMinCharCode = '!'.charCodeAt(0);
    const kMaxCharCode = '~'.charCodeAt(0);
    var pwd = "";
    for (var i = 0; i < kPasswordLen; ++i)
    {
      var val = this._crypto_rand_int(kMaxCharCode - kMinCharCode + 1);
      if (val < 0)
      {
        TorLauncherLogger.log(4, "_crypto_rand_int() failed");
        return null;
      }

      pwd += this._toHex(kMinCharCode + val, 2);
    }

    return pwd;
  },

  // Based on Vidalia's TorSettings::hashPassword().
  _hashPassword: function(aHexPassword)
  {
    if (!aHexPassword)
      return null;

    // Generate a random, 8 byte salt value.
    var salt;
    if (this.mCheckPasswordHash)
    {
      salt = new Array(8);
      salt[0] = 0x33;
      salt[1] = 0x9E;
      salt[2] = 0x10;
      salt[3] = 0x73;
      salt[4] = 0xCA;
      salt[5] = 0x36;
      salt[6] = 0x26;
      salt[7] = 0x9D;
    }
    else
      salt = this._RNGService.generateRandomBytes(8);

    // Convert hex-encoded password to an array of bytes.
    var len = aHexPassword.length / 2;
    var password = new Array(len);
    for (var i = 0; i < len; ++i)
      password[i] = parseInt(aHexPassword.substr(i * 2, 2), 16);

    // Run through the S2K algorithm and convert to a string.
    const kCodedCount = 96;
    var hashVal = this._crypto_secret_to_key(password, salt, kCodedCount);
    if (!hashVal)
    {
      TorLauncherLogger.log(4, "_crypto_secret_to_key() failed");
      return null;
    }

    var rv = "16:";
    rv += this._ArrayToHex(salt);
    rv += this._toHex(kCodedCount, 2);
    rv += this._ArrayToHex(hashVal);

    if (this.mCheckPasswordHash)
    {
      dump("hash for:\n" + aHexPassword + "\nis\n" + rv + "\n");
      const kExpected = "16:339e1073ca36269d6014964b08e1e13b08564e3957806999cd3435acdd";
      dump("should be:\n" + kExpected + "\n");
      if (kExpected != rv)
        dump("\n\nHASH DOES NOT MATCH\n\n\n");
      else
        dump("\n\nHASH IS CORRECT!\n\n\n");
    }

    return rv;
  }, // _hashPassword()

  // Returns -1 upon failure.
  _crypto_rand_int: function(aMax)
  {
    // Based on tor's crypto_rand_int().
    const kMaxUInt = 0xffffffff;
    if (aMax <= 0 || (aMax > kMaxUInt))
      return -1;

    var cutoff = kMaxUInt - (kMaxUInt % aMax);
    while (true)
    {
      var bytes = this._RNGService.generateRandomBytes(4);
      var val = 0;
      for (var i = 0; i < bytes.length; ++i)
      {
        val = val << 8;
        val |= bytes[i];
      }

      val = (val>>>0);    // Convert to unsigned.
      if (val < cutoff)
        return val % aMax;
    }
  },

  // _crypto_secret_to_key() is similar to Vidalia's crypto_secret_to_key().
  // It generates and returns a hash of aPassword by following the iterated
  // and salted S2K algorithm (see RFC 2440 section 3.6.1.3).
  // Returns an array of bytes.
  _crypto_secret_to_key: function(aPassword, aSalt, aCodedCount)
  {
    if (!aPassword || !aSalt)
      return null;

    var inputArray = aSalt.concat(aPassword);

    var hasher = Cc["@mozilla.org/security/hash;1"]
                   .createInstance(Ci.nsICryptoHash);
    hasher.init(hasher.SHA1);
    const kEXPBIAS = 6;
    var count = (16 + (aCodedCount & 15)) << ((aCodedCount >> 4) + kEXPBIAS);
    while (count > 0)
    {
      if (count > inputArray.length)
      {
        hasher.update(inputArray, inputArray.length);
        count -= inputArray.length;
      }
      else
      {
        var finalArray = inputArray.slice(0, count);
        hasher.update(finalArray, finalArray.length);
        count = 0;
      }
    }

    var hashResult = hasher.finish(false);
    if (!hashResult || (0 == hashResult.length))
      return null;

    var hashLen = hashResult.length;
    var rv = new Array(hashLen);
    for (var i = 0; i < hashLen; ++i)
      rv[i] = hashResult.charCodeAt(i);

    return rv;
  },

  _isDigit: function(aChar)
  {
    const kRE = /^\d$/;
    return aChar && kRE.test(aChar);
  },

  _toHex: function(aValue, aMinLen)
  {
    var rv = aValue.toString(16);
    while (rv.length < aMinLen)
      rv = '0' + rv;

    return rv;
  },

  _ArrayToHex: function(aArray)
  {
    var rv = "";
    if (aArray)
    {
      for (var i = 0; i < aArray.length; ++i)
        rv += this._toHex(aArray[i], 2);
    }

    return rv;
  },

  _read_authentication_cookie: function(aPath)
  {
    var file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsILocalFile);
    file.initWithPath(aPath);
    var fileStream = Cc["@mozilla.org/network/file-input-stream;1"]
                       .createInstance(Ci.nsIFileInputStream);
    fileStream.init(file, 1, 0, false);
    var binaryStream = Cc['@mozilla.org/binaryinputstream;1']
                         .createInstance(Ci.nsIBinaryInputStream);
    binaryStream.setInputStream(fileStream);
    var array = binaryStream.readByteArray(fileStream.available());
    binaryStream.close();
    fileStream.close();
    return array.map(function(c) {
                       return String("0" + c.toString(16)).slice(-2)
                     }).join('');
  },

  get _RNGService()
  {
    if (!this.mRNGService)
    {
      this.mRNGService = Cc["@mozilla.org/security/random-generator;1"]
                           .createInstance(Ci.nsIRandomGenerator);
    }

    return this.mRNGService;
  },


  // Debugging Methods ///////////////////////////////////////////////////////
  _dumpObj: function(aObjDesc, aObj)
  {
    if (!aObjDesc)
      aObjDesc = "JS object";

    if (!aObj)
    {
      dump(aObjDesc + " is undefined" + "\n");
      return;
    }

    for (var prop in aObj)
      dump(aObjDesc + "." + prop + ": " + aObj[prop] + "\n");
  },

  endOfObject: true
};


var gTorProtocolService = new TorProtocolService;


// TODO: Mark wants to research use of XPCOMUtils.generateNSGetFactory
// Cu.import("resource://gre/modules/XPCOMUtils.jsm");
function NSGetFactory(aClassID)
{
  if (!aClassID.equals(gTorProtocolService.kClassID))
    throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;

  return gTorProtocolService;
}