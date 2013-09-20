/*
The following utilities will encapsulate any crypto and
remote API calls (IMAP/SMTP/Parley).

NB. I've replaced jQuery's usual success and error callbacks with a single
"finished" callback. It has the same signature as jQuery's success; errors
are massaged to fit. The arguments to finished on ajax error look like:
  {'error':ErrorString},textStatus,jqXHR
*/


/*
 * for changing uid and pass, we'll probably need to play aroudn with low-level
 * stuff:
 * see generate_key_pair and openpgp_crypto_generateKeyPair for clues
 * */

(function (Parley) {

  Parley.BASE_URL = "https://api.parley.co";

  //node-webkit allows us to use node modules
  var crypto = require('crypto');
  var http = require('http');

  //wrappers, because Node's http is annoying
  var HKPrequest = function(op, search, callback) {
    //build options
    var path = '/pks/lookup?exact=on&options=mr&op='+op+'&search='+encodeURIComponent(search);
    var options = {
      'hostname': 'pgp.mit.edu',
      'port': 11371,
      'path': path,
      'method': 'GET'
    }
    var req = http.request(options, callback);
    req.end();
  }
  var HKPsubmit = function(armoredKey, callback) {
    //build options
    var path = '/pks/add';
    var options = {
      'hostname': 'pgp.mit.edu',
      'port': 11371,
      'path': path,
      'method': 'POST'
    }
    var req = http.request(options, callback);
    req.write('keytext='+encodeURIComponent(armoredKey)+'\n');
    req.end();
  }

  //clear stored keys before initializing, for multi-user scenario
  window.localStorage.removeItem('privatekeys');
  window.localStorage.removeItem('publickeys');
  window.showMessages = function (text) { //because openpgp.js is weird
    console.log($(text).text());
  }
  openpgp.init(); //openpgp.min.js must be included in index.html

  Parley.PGP = {
    'genKey': function(sendKey) {
      var uid = Parley.currentUser.get('name') + ' (Generated by Parley) '
        + Parley.currentUser.get('email');
      var keyPair = openpgp.generate_key_pair(1,4096,uid,
        Parley.currentUser.get('passwords').local);
      openpgp.keyring.importPrivateKey(keyPair.privateKeyArmored,Parley.currentUser.get('passwords').local);
ne
      openpgp.keyring.importPublicKey(keyPair.publicKeyArmored);
      if (sendKey) {
        HKPsubmit(keyPair.publicKeyArmored,console.log);
      }
    },
    'importEncryptedKeyring': function(b64Keyring) {

      //legacy support:
      //old pure-Python AES
      var oldAES = function(b64CipherText, passphrase) {
        var buf = new Buffer(b64CipherText,'base64');
        var iv = buf.slice(0,16);
        var data = buf.slice(16);
        var key = passphrase.substr(0,32);
        var decipher = crypto.createDecipheriv('aes-256-cbc',key,iv);
        return decipher.update(data,'utf8','utf8') + decipher.final('utf8');
      }

      //old GPG
      var oldGPG = function(b64CipherText, passphrase) {
        //the following was really fucking hard to figure out, because
        //openpgp.js doesn't support symmetric-key encrypted session key
        //packets (tagType == 3) properly.
        //TODO: contribute a fix, and implement it more cleanly here
        //-see http://tools.ietf.org/html/rfc4880#section-5.3

        openpgp.config.debug = true;
        var debug = {'base64inputLength':b64CipherText.length};

        var cipherText = openpgp_encoding_base64_decode(b64CipherText);
        var ctLength = cipherText.length;

        debug.ctLength = ctLength;
        var reB64 = openpgp_encoding_base64_encode(cipherText);
        debug.reB64length = reB64.length;
        console.log(debug);

        var sessionKey = openpgp_packet.read_packet(cipherText,0,ctLength);
        var skLength = sessionKey.headerLength + sessionKey.packetLength;

        var encryptedCompressedData = openpgp_packet.read_packet(
            cipherText,
            skLength,
            ctLength - skLength);

        var aesKey = sessionKey.s2k.produce_key(
            passphrase,
            32).substr(0,32);

        var compressedData = openpgp_crypto_symmetricDecrypt(
            9,
            aesKey,
            encryptedCompressedData.encryptedData,
            false);

        var compressedPacket = openpgp_packet.read_packet(
            compressedData,
            0,
            compressedData.length);
        var data = compressedPacket.decompress();

        console.log('data length', data.length);
        openpgp.config.debug = false;

        //in the test case, the decompressed data appeared to have nonsense
        //bits prepended to it--presumably openpgp_packet_compressed.read_packet
        //is failing to strip some header info.
        //For our own purposes, the following fix is sufficient:
        return data.substr(data.indexOf('{'));
      }

      //var cipherText = new Buffer(b64Keyring,'base64').toString('utf8');
      var passphrase = Parley.currentUser.get('passwords').local;
      var json = '';

      //have to do this in a very convoluted fashion
      //because who knows what will cause an error and what won't
      try {
        //try current decryption method (from node.js crypto
        //module, using OpenSSL)
        var key = new Buffer(passphrase,'hex');
        var decipher = crypto.createDecipher('aes256',key);
        return decipher.update(b64Keyring, 'base64', 'utf8') + decipher.final('utf8');
      } catch (e) {
        console.log(e.message);
      }

      if (!json) {
        //try old GPG decryption
        try {
          json = oldGPG(b64Keyring, passphrase);
        } catch (e) {
          console.log(e.message);
        }
      }

      if (!json) {
        //try old "pure python AES"
        try {
          json = oldAES(b64Keyring, passphrase);
        } catch (e) {
          console.log(e.message);
        }
      }

      var keyObj = JSON.parse(json);

      openpgp.keyring.importPrivateKey(keyObj['private'],Parley.currentUser.get('passwords').local);
      openpgp.keyring.importPublicKey(keyObj['public']);
      //add fingerprints to imported keys, as well as any other expected attributes
      _.each(openpgp.keyring.publicKeys, function (key) {
        key.fingerprint = key.obj.getFingerprint();
        key.keyId = key.keyid = key.obj.getKeyId();
        key.uids = _.map(key.obj.userIds, function(uid) { return uid.text });
      });
      return true;
    },
    'getEncryptedKeyring': function() {
      var publicKeys = _.pluck(openpgp.keyring.publicKeys, 'armored');
      var privateKeys = _.pluck(openpgp.keyring.privateKeys, 'armored');

      var symmetricKey = new Buffer(Parley.currentUser.get('passwords').local,'hex');

      var data = JSON.stringify({'public':publicKeys,'private':privateKeys});

      var cipher = crypto.createCipher('aes256',symmetricKey);
      return cipher.update(data, 'utf8', 'base64') + cipher.final('base64');
    },
    'getPublicKey': function() {
      var secretKey = openpgp.keyring.getPrivateKeyForAddress(
          Parley.currentUser.get('email'));
      return secretKey[0].obj.extractPublicKey();
    },
    'listKeys': function() {
      return openpgp.keyring.publicKeys;
    },
    'fetchKey': function(email, callback) {
      //search for keys, import first match, and send key fingerprint to callback
      HKPrequest('index','<'+email+'>',function (res1) {
        res1.setEncoding('utf8');
        res1.on('data', function (index) {
          try {
            //parse index to get first keyId
            var firstLine = index.split('\n')[1];
            var keyId = '0x'+firstLine.split(':')[1];
            HKPrequest('get',keyId, function (res2) {
              res2.setEncoding('utf8');
              res2.on('data', function(chunk) {
                try {
                  //because pgp.mit.edu isn't running the latest SKS,
                  //it doesn't send machine readable keys properly,
                  //so we might have to parse some HTML here :(
                  if (chunk.indexOf('<pre>') != -1) {
                    chunk = chunk.split('<pre>')[1];
                    chunk = chunk.split('</pre>')[0];
                  }

                  var key = Parley.PGP.importKey(chunk);
                  callback(key.fingerprint);
                } catch (e) {
                  console.log('Error importing fetched key: '+e.message);
                }
              });
            });
          } catch (e) {
            console.log('Error fetching key list: '+e.message);
          }
        });
      });
    },
    'importKey':function(key) {
      openpgp.keyring.importPublicKey(key);
      returnObj = _.last(openpgp.keyring.publicKeys);
      returnObj.fingerprint = returnObj.obj.getFingerprint();
      returnObj.keyId = returnObj.keyid = returnObj.obj.getKeyId();
      returnObj.uids = _.map(returnObj.obj.userIds, function(uid) { return uid.text });
      returnObj.fingerprints = [returnObj.fingerprint];

      //de-dupe keyring
      _.uniq(openpgp.keyring.publicKeys, function (key) { return key.keyId });
      _.uniq(openpgp.keyring.privateKeys, function (key) { return key.keyId });

      return returnObj;
    },
    'revokeKey': function() {
      //generate revocation signature:
      var Sig = new openpgp_packet_signature();
      var email = Parley.currentUser.get('email');
      var toRevoke = openpgp.keyring.getPublicKeyForAddress(email)[0].obj.data;
      var privateKey = openpgp.keyring.getPrivateKeyForAddress(email)[0].obj;
      sig = Sig.write_message_signature(32,toRevoke,privateKey);
      
      var revokedKey = openpgp_encoding_armor(4,toRevoke+sig);

      HKPsubmit(revokedKey,console.log);
      return revokedKey;
    },
    'changeName': function(newName) {
      //TODO: test this!!!

      //the following borrows heavily from generate_key_pair
      var email = Parley.currentUser.get('email');
      var privKey = openpgp.keyring.getPrivateKeyForAddress(email)[0];
      var pubKey = openpgp.keyring.getPublicKeyForAddress(email)[0];
      var publicKeyString = privKey.obj.privateKeyPacket.publicKey.data;
      var publicKeyHeader = privKey.obj.privateKeyPacket.publicKey.header;
      var privateKeyString = (function(keyData){
        //we're looking for the private key data without the userId packet appended
        var oldUIDtext = privKey.obj.userIds[0].text;
        var oldUID = (new openpgp_packet_userid).write_packet(oldUIDtext);
        var pos = keyData.indexOf(oldUID);
        return keyData.substr(0,pos);
      })(privKey.obj.data);
      var userId = newName + ' (Generated by Parley) <'+email+'>';

      var hashData = String.fromCharCode(0x99)+ String.fromCharCode(((publicKeyString.length) >> 8) & 0xFF) 
          + String.fromCharCode((publicKeyString.length) & 0xFF) +publicKeyString+String.fromCharCode(0xB4) +
          String.fromCharCode((userId.length) >> 24) +String.fromCharCode(((userId.length) >> 16) & 0xFF) 
          + String.fromCharCode(((userId.length) >> 8) & 0xFF) + String.fromCharCode((userId.length) & 0xFF) + userId
      var signature = new openpgp_packet_signature();
      signature = signature.write_message_signature(16,hashData, privKey.obj);

      var userIdString = (new openpgp_packet_userid()).write_packet(userId);

      pubKey.armored = openpgp_encoding_armor(4, publicKeyHeader + publicKeyString + userIdString + signature.openpgp );
      privateKeyString += userIdString + signature.openpgp;

      var header = openpgp_packet.write_packet_header(5,privateKeyString.length);
      privKey.armored = openpgp_encoding_armor(5,header+privateKeyString);

      privKey.obj = openpgp.read_privateKey(privKey.armored)[0];
      pubKey.obj = openpgp.read_publicKey(pubKey.armored)[0];
      //TODO assign fingerprint, etc as in import fn
      //TODO: fix userIDs!! they're not getting re-imported :(

      //TODO:implement currentUser.publish attribute
      if (Parley.currentUser.get('publish')) HKPsubmit(pubKey.armored,console.log);

      var success = 'success', error = 'none';
      //this weird return format is for backwards compatibility.
      //if/when it can be improved, it should
      return [success, error];
    },
    'changePass': function(oldPass,newPass) {
      //TODO: TEST !!!
      //we want to replace the MPI with a new one, encrypted using
      //the new passphrase, then rebuild and rearmor the key
      var email = Parley.currentUser.get('email');
      var privateKey = openpgp.keyring.getPrivateKeyForAddress(email)[0];

      privateKey.obj.privateKeyPacket.decryptSecretMPIs(oldPass);
      var clearTextMPIs = privateKey.obj.privateKeyPacket.secMPIs.join('');

      var keyData = privateKey.obj.data;
      var pos = keyData.indexOf(privateKey.obj.privateKeyPacket.IV)
          - 8 /* salt length */ - 1 /* count octet */;
      var preAmble = keyData.substr(0,pos); //includes the key header, public key, etc

      var UIDtext = privateKey.obj.userIds[0].text;
      var UID = (new openpgp_packet_userid).write_packet(UIDtext);

      var hashData = String.fromCharCode(0x99)+ String.fromCharCode(((publicKeyString.length) >> 8) & 0xFF)
          + String.fromCharCode((publicKeyString.length) & 0xFF) +publicKeyString+String.fromCharCode(0xB4) +
          String.fromCharCode((UIDtext.length) >> 24) +String.fromCharCode(((UIDtext.length) >> 16) & 0xFF)
          + String.fromCharCode(((UIDtext.length) >> 8) & 0xFF) + String.fromCharCode((UIDtext.length) & 0xFF) + UIDtext;
      var signature = new openpgp_packet_signature();
      signature = signature.write_message_signature(16,hashData, privKey.obj);
      var postAmble = UID + signature.openpgp;

      var oldSalt = privateKey.obj.data.substr(pos,8);
      var newSalt = openpgp_crypto_getRandomBytes(8); 
      var s2kHash = privateKey.obj.data.substr(pos-1,1);
      var symmetricAlgo = privateKey.obj.data.substr(pos-3,1);
      var sha1Hash = str_sha1(clearTextMPIs);
      var s2k = new openpgp_type_s2k();
      var hashKey = s2k.write(3, s2kHash, newPass, newSalt, 96);

      var newAmble = newSalt + String.fromCharCode(96);

      switch (symmetricAlgo) {
        case 3:
          IVLength = 8;
          IV = openpgp_crypto_getRandomBytes(this.IVLength);
          ciphertextMPIs = normal_cfb_encrypt(function(block, key) {
            var cast5 = new openpgp_symenc_cast5();
            cast5.setKey(key);
            return cast5.encrypt(util.str2bin(block)); 
          }, IVLength, util.str2bin(hashKey.substring(0,16)), cleartextMPIs + sha1Hash, IV);
          newAmble += IV + ciphertextMPIs;
          break;
        case 7:
        case 8:
        case 9:
          IVLength = 16;
          IV = openpgp_crypto_getRandomBytes(IVLength);
          ciphertextMPIs = normal_cfb_encrypt(AESencrypt,
 	      IVLength, hashKey, cleartextMPIs + sha1Hash, IV);
          newAmble += IV + ciphertextMPIs;
	  break;
      }
      var newKey = preAmble + newAmble + postAmble;
      var header = openpgp_packet.write_packet_header(5,newKey.length);
      privateKey.armored = openpgp_encoding_armor(5,header+newKey);
      privateKey.obj = openpgp.read_privateKey(privateKey.armored)[0];

      var success = 'success', error = 'none';
      //this weird return format is for backwards compatibility.
      //if/when it can be improved, it should
      return [success, error];
    },
    'encryptAndSign': function(data, recipients, signer, passphrase) {
      var privateKey = openpgp.keyring.getPrivateKeyForKeyId(
          signer.subtr(signer.length-8));
      var publicKeys = _.map(recipients, function(i){
        i.substr(i.length-8);
      });
      var encrypted = openpgp.write_signed_and_encrypted_message(privateKey,publicKeys,data);
      return encrypted;
    },
    'decryptAndVerify': function(data, passphrase, sender_id) {
      var message = openpgp.read_message(data);
      return message;
    },
    'ksUtil': { 'get': HKPrequest, 'post': HKPsubmit }
  }

  /**
  Wrapping encodeURIComponent in case we accidentally call it twice.
  Ideally this doesn't exist, but for now, until we get tidier, voila.

  If a string is NOT encoded OR does not contain an @, it will be encoded
  **/
  Parley.encodeEmail = function (email) {
    if (email)
      return (!~email.indexOf('%40') ? email : encodeURIComponent(email));
    return '';
  }

  //This is just a shim in case Parley.Contact isn't defined elsewhere
  Parley.Contact = Parley.Contact || function () {
    this.attributes = this.attributes || {};
    return {
      'set': function (key, val) {
        return this.attributes[key] = val;
      },
      'get': function (key) {
        return this.attributes[key];
      }
    }
  }
  Parley.installed = function(){
      //legacy function; deprecated since install process is no longer
      //a thing
      //(make sure all calls to it are gone before it can be removed)
      return true;
  }
  Parley.install = function(finished){
      //also legacy, also deprecated (see above)
      _.delay(finished,1000);
  }

  /* Sign Parley API request--identical to Amazon API signing method,
  but timestamped and using password hash as the secret key. */
  Parley.signAPIRequest = function (url, method, data) {
    //temporarily disable post request (so as not to fuck up server
    //with dev branch)
    if (method.toLowerCase() != 'get') return ''; //TODO: remove this line for prod, and make server allow CORS
    for (var key in data) {
      data[key] = ''+data[key];
    }
    var valuePairs = _.pairs(data);
    var sorted = _.sortBy(valuePairs,function(i){return i[0]});
    var urlComponents = _.map(sorted,function(i){
      return encodeURIComponent(i[0]) + '=' + encodeURIComponent(i[1]);
    });
    return crypto.createHmac(
        'SHA256',
        Parley.currentUser.get('passwords').remote)
      .update(method+'|'+url+'?'+urlComponents.join('&'))
      .digest('base64')
      .replace(/\+/g,'-')
      .replace(/\//g,'_')
      .replace(/=+$/g,'');
  }

  Parley.pbkdf2 = function (data) {
    var salt = Parley.currentUser.get('email') + '10620cd1fe3b07d0a0c067934c1496593e75994a26d6441b835635d98fda90db';
    return crypto.pbkdf2Sync(data, salt.toLowerCase(), 2048, 32).toString('hex');
  }
  
  /* Check if a user is already registered with Parley.
  Accepts email address, finished callback */
  Parley.requestUser = function (email, finished) {
    finished = finished || function(){};
    return $.ajax({
      type:'GET',
      url:Parley.BASE_URL+'/u/'+Parley.encodeEmail(email),
      success:finished,
      error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }
  
  /* Generate a new keypair and hashed system password for Parley, then register with the given
  email. This function will take some time to execute, and may block during the key-gen phase, so
  decorate the UI accordingly.
  Accepts email, cleartext password, finished callback */
  Parley.registerUser = function (name, email, clearTextPassword, sendKey, finished) {
    sendKey = !!sendKey;
    Parley.currentUser = Parley.currentUser || new Parley.Contact({isCurrentUser:true});
    Parley.currentUser.set('name', name);
    Parley.currentUser.set('email', email);
    var passwords = Parley.currentUser.get('passwords') || {};
    passwords.local = Parley.pbkdf2(clearTextPassword);
    passwords.remote = Parley.pbkdf2(passwords.local);
    Parley.currentUser.set('passwords', passwords);
    $.ajax({
      type:'POST',
      url:Parley.BASE_URL+'/u/'+Parley.encodeEmail(email),
      data:{
        'name':name,
        'p':Parley.currentUser.get('passwords').remote
      },
      success: function() {
        Parley.PGP.genKey(sendKey);
        Parley.storeKeyring(finished);
      },
      error: function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }

  Parley.authenticateUser = function(email, clearTextPassword, finished) {
    Parley.currentUser = Parley.currentUser || new Parley.Contact({isCurrentUser:true});
    Parley.currentUser.set('email', email);
    var passwords = Parley.currentUser.get('passwords') || {};
    passwords.local = Parley.pbkdf2(clearTextPassword);
    passwords.remote = Parley.pbkdf2(passwords.local);
    Parley.currentUser.set('passwords', passwords);
    Parley.requestKeyring(finished);
  }
  
  Parley.updateUser = function (data, finished) {
    data = data || {};

    _.each(data, function (v,k) { Parley.currentUser.set(k,v); });

    var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(Parley.currentUser.get('email'));
    data.time = Math.floor((new Date())/1000);
    data.sig = Parley.signAPIRequest(url, 'POST', data);

    $.ajax({
      type:'POST',
      url:url,
      data:data,
      headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+data.sig, 'Sig-Time':data.time},
      success:finished,
      error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }

  Parley.killUser = function(finished) {
    var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(Parley.currentUser.get('email'));
    var data = {'time':Math.floor((new Date())/1000)};
    data.sig = Parley.signAPIRequest(url, 'DELETE', data);

    $.ajax({
      type:'DELETE',
      url:url,
      data:data,
      headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+data.sig, 'Sig-Time':data.time},
      success:function(a,b,c) {
        a.revoked = Parley.PGP.revokeKey();
        if (!a.revoked) {
          a.error = 'Failed to revoke key';
        }
        finished(a,b,c);
      },
      error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }

  /* Requests keyring of currrently authenticated user.
  Accepts finished callback */
  Parley.requestKeyring = function(finished) {
    if (!Parley.currentUser) {
      throw "Error: There is no currently authenticated user.";
    } else {
      var email = Parley.currentUser.get('email');
      var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(email);
      var time = Math.floor((new Date())/1000);
      var sig = Parley.signAPIRequest(url,'GET',{'time':time});
      $.ajax({
        type:'GET',
        url:url,
        headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+sig, 'Sig-Time' : time},
        data:{'time':time,'sig':sig},
        success:function(data, textStatus, jqXHR) {
          if (data.keyring) {
            Parley.PGP.importEncryptedKeyring(data.keyring);
          } else {
            data.error = 'Failed to authenticate. Returning public user info.';
          }
          finished(data, textStatus, jqXHR);
        },
        error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
        dataType:'json'
      });
    }
  }

  /*
   * Save user data (such as settings/preferences) to server.
   * Ideally "data" is a shallow object (ie. a dict with only
   * strings/numbers for values) since I haven't tested anything
   * else.
   * */
  Parley.saveUser = function(data,finished) {
    if (!Parley.currentUser) {
      throw "Error: There is no currently authenticated user.";
    } else {
      var email = Parley.currentUser.get('email');
      var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(email);
      data.time = Math.floor((new Date())/1000);
      if (data.name) {
        Parley.PGP.changeName(data.name);
        data.keyring = Parley.PGP.getEncryptedKeyring();
      }
      var sig = Parley.signAPIRequest(url,'POST',data);
      data.sig = sig;
      $.ajax({
        type:'POST',
        url:url,
        headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+data.sig, 'Sig-Time' : data.time},
        data:data,
        success: finished,
        error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
        dataType:'json'
      });
    }
  };
  
  /* Stores (encrypted) local keyring on the server.
  Accepts finished callback. */
  Parley.storeKeyring = _.debounce(function(finished) {
    console.log('Storing keyring');
    var keyring = Parley.PGP.getEncryptedKeyring(),
        finished = finished || function () {};
    Parley.saveUser({'keyring':keyring, 'public_key':Parley.PGP.getPublicKey()}, finished);
  }, 1000*3);
  
  /* Requests the public key corresponding to an email address from public keyservers.
  This function can take a bit of time to execute.
  Accepts email address, returns key fingerprint on success or null on failure. */
  //NB. Although this function is called by several others to allow strings to
  //be used in place of Contact objects (ie. the encrypt and decrypt functions)
  //it is probably better to create Contact objects using this function first
  //and then pass the entire object to encrypt/decrypt/etc. (See Parley.AFIS)
  Parley.requestPublicKey = Parley.PGP.fetchKey;

  Parley.importKey = Parley.importPublicKey = Parley.importSecretKey = Parley.PGP.importKey;

  Parley.changePass = function(oldPass, newPass, finished) {
    if (Parley.pbkdf2(oldPass) == Parley.currentUser.get('passwords').local) { //this is extremely superficial (because PWs are already in memory) but hopefully will at least reduce the likelihood of situations like "my little brother saw Parley open and decided to change my password"
      var oldLocal, newLocal, oldRemote, newRemote, passwords = Parley.currentUser.get('passwords');
      oldLocal = passwords.local;
      oldRemote = passwords.remote;
      passwords.local = newLocal = Parley.pbkdf2(newPass);
      passwords.remote = newRemote = Parley.pbkdf2(newLocal);
      Parley.PGP.changePass(oldLocal,newLocal); //change keyring passphrase

      //update passwords on server along with keyring
      var email = Parley.currentUser.get('email');
      var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(email);
      var keyring = Parley.PGP.getEncryptedKeyring();
      var data = {'time': Math.floor((new Date())/1000), 'keyring': keyring, 'public_key':Parley.PGP.getPublicKey(),'secret':newRemote};

      //reset to old passwords temporarily for signing API request
      //(because the server will validate agains the old secret)
      passwords.local = oldLocal;
      passwords.remote = oldRemote;
      var sig = Parley.signAPIRequest(url,'POST',data);
      passwords.local = newLocal;
      passwords.remote = newRemote;
      data.sig = sig;

      $.ajax({
        type:'POST',
        url:url,
        headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+data.sig, 'Sig-Time': data.time},
        data:data,
        success: finished,
        error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
        dataType:'json'
      });
    }
  }


  //This function could be used to build Parley.Contacts from a keyring
  //after importing it or adding a new key.
  Parley.listKeys = Parley.PGP.listKeys;

  /*This function returns key meta data belonging to a given fingerprint.
    Could be used in tandem with requestPublicKey to create a new Contact
    ie.

      Contact.init = function(email) {
        var contact = this;
        var planA = function(userinfo) {
          if (!userinfo.public_key) {
            planB();
          } else {
            var key = Parley.importKey(userinfo.public_key);
            var fingerprint = key.fingerprints[0];
            _.extend(userinfo,Parley.AFIS(fingerprint));
          }
        }
        var planB = function() {
          var fingerprint = Parley.requestPublicKey(email);
          var userinfo = Parley.AFIS(fingerprint);
          var parsed = Parley.parseUID(userinfo.uids[0]);
          userinfo.name = parsed.name;
          userinfo.email = parsed.email;
          contact.set(userinfo);
        }
        requestUser(email).success(planA).error(planB);
      }

  */
  Parley.AFIS = function(fingerprint) {
    var keys = Parley.listKeys();
    return _(keys).where({'fingerprint':fingerprint})[0];
  }

  //sort of a "reverse AFIS", if you will:
  //pull some ratty kid off the streets and get their prints
  Parley.perpWalk = function(contact) {
    var uid = contact.get('name') || 'None' + ' (Generated by Parley) <' + contact.get('email') + '>';
    var keys = Parley.listKeys();
    keys = _(keys).filter(function (key) { return key.uids[0] === uid });
    keys = _(keys).sortBy('date');
    return _(keys).last().fingerprint;
  }

  //Split a UID into name and email address
  Parley.parseUID = function(UIDString) {
    return {
      'name': UIDString.split(" <")[0].split(" (")[0],
      'email': UIDString.split(" <")[1].split(">")[0]
    }
  }

  /* Sign, encrypt and send message to recipient(s).
  Accepts clearTextMessage as a String and recipients as an array of Contacts.
  Also takes finished callback. */
  Parley.encryptAndSend = function(clearTextSubject, clearTextMessage, recipients, finished) {
    var recipientKeys = _(recipients).map(function(recipient) {
      if (_.isString(recipient)) {
        return Parley.requestPublicKey(recipient);
      } else {
        return recipient.get('fingerprint');
      }
    });
    var recipientEmails = _(recipients).map(function(recipient) {
      if (_.isString(recipient)) {
        return recipient;
      } else {
        return recipient.get('email');
      }
    });

    var messageText = Parley.PGP.encryptAndSign(clearTextMessage, recipientKeys, Parley.currentUser.get('fingerprint'), Parley.currentUser.get('passwords').local);

    var message = {
      'from':null,
      'to':recipientEmails,
      'subject':clearTextSubject,
      'text':messageText
    };
    var url = Parley.BASE_URL+'/smtp/send';
    var data = {
      'time': Math.floor((new Date())/1000),
      'user': Parley.currentUser.get('email'),
      'message': JSON.stringify(message)
    };
    var sig = Parley.signAPIRequest(url,'POST',data);
    data.sig = sig;
    $.ajax({
      type:'POST',
      url:url,
      headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+data.sig, 'Sig-Time': data.time},
      data:data,
      success:finished,
      error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }
  
  /* Decrypt a message from sender.
  Accepts the encrypted message body and sender as either an email address or Contact object
  */
  Parley.decryptAndVerify = function(encryptedMessage, sender) {

    var keyid, email;
    if (_.isString(sender)) {
      email = sender;
      keyid = Parley.requestPublicKey(email);
    } else if (sender.get('fingerprint')) {
      keyid = sender.get('fingerprint');
    } else if (sender.get('email')) {
      keyid = Parley.requestPublicKey(sender.get('email'));
      sender.set('fingerprint',keyid)
    } else {
      throw "Error: Sender is illegible."
    }
    return Parley.PGP.decryptAndVerify(encryptedMessage, Parley.currentUser.get('passwords').local, keyid);
  }

  Parley.quote = function(message) {
    return '\r\n\r\n\r\n> ' + message.replace(/\r?\n/g,'\r\n> ');
  }

  Parley.insertBRs = function(message) {
    return message.replace(/\r?\n/g,'<br/>');
  }
  
  /* Send Parley invitation from current user to email address
  via the Parley API's invite method.
  Accepts email as string, finished callback, and optional "gift" boolean. */
  Parley.invite = function(email, finished, gift) {
    finished = finished || {};
    if (!Parley.currentUser) {
      throw "Error: There is no currently authenticated user.";
    } else {
      var url = Parley.BASE_URL+'/invite/'+Parley.encodeEmail(email);
      var data = { 'user': Parley.currentUser.get('email') };
      if (!!gift) {
        //if signature is defined, server will try to share a paid account
        data.time = Math.floor((new Date())/1000);
        var sig = Parley.signAPIRequest(url,'POST',data);
        data.sig = sig;
      }

      $.ajax({
        type:'POST',
        url:Parley.BASE_URL+'/invite/'+Parley.encodeEmail(email),
        headers:data.sig ? {'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+data.sig, 'Sig-Time': data.time} : {},
        data:data,
        success:finished,
        error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
        dataType:'json'
      });
    }
  }

  Parley.registerInbox = function() {
    var email = Parley.currentUser.get('email');
    var url = Parley.BASE_URL+'/imap/connect/' + Parley.encodeEmail(email);
    var data = { 'time': Math.floor((new Date())/1000) };
    var sig = Parley.signAPIRequest(url,'GET',data);
    data.sig = sig;
    $.getJSON(url, data, function(data) {
      var newWin = window.open(data.browser_redirect_url);
    });
  }

  //wait a second, ask server for imap server, check response,
  //wait another second...
  Parley.waitForRegisteredInbox = function(finished) {
    var email = Parley.currentUser.get('email');
    var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(email);
    var time = Math.floor((new Date())/1000);
    var sig = Parley.signAPIRequest(url,'GET',{'time':time});
    $.ajax({
      type:'GET',
      url:url,
      headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+sig, 'Sig-Time':time},
      data:{'time':time,'sig':sig},
      success:function(data, textStatus, jqXHR) {
        if (data.imap_account) {
          finished(true);
        } else {
          _.delay(Parley.waitForRegisteredInbox, 1000, finished);
        }
      },
      error:function(jqXHR,textStatus,errorString){finished(false);},
      dataType:'json'
    });
  };

  /* This function pulls down 50 messages at a time from the user's IMAP
  server, but only returns the ones with the "BEGIN PGP" section (ie. the
  encrypted ones). Therefore the client should expect anywhere between 0
  and 100 messages to be returned per request, and could continue calling
  this function until the UI is populated.

  eg.

    var inboxFiller = function (targetNumber, lastOffset) {
      Parley.requestInbox(lastOffset, function(data, status, jqXHR) {
        if (data.messages.length < targetNumber) {
          inboxFiller(targetNumber-data.messages.length, lastOffset+100)
          Parley.Inbox.add(data.messages)
          //probably also makes sense to store lastOffset somewhere for later
          //if the user scrolls down or next page or whatever
        }
      }
    }

  Note that the response format is:
    {
      "messages": [
        {
          "body": {
            "content": <body content as string--this can get passed to decryptAndVerify>,
            ...<other body attributes such as type and charset (see CIO docs)>
          },
          ...<other message attributes such as IDs and what-not (see CIO docs)>
        },
        ...<other messages>
      ]
    }
  */
  Parley.requestInbox = function(offset, finished) {
    var url = Parley.BASE_URL+'/imap/get';
    var data = {
      'user' : Parley.currentUser.get('email'),
      'offset' : offset || 0,
      'time' : Math.floor((new Date())/1000)
    }
    var sig = Parley.signAPIRequest(url,'GET',data);
    data.sig = sig;
    $.ajax({
      type:'GET',
      url:url,
      headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+data.sig, 'Sig-Time':data.time},
      data:data,
      success:finished,
      error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }

  //Fetch 20 contacts to whom currentUser has sent the most mail
  //in the past 6 months
  Parley.requestContacts = function(finished) {
    var url = Parley.BASE_URL+'/imap/contacts';
    var data = {
      'user' : Parley.currentUser.get('email'),
      'time' : Math.floor((new Date())/1000)
    }
    var sig = Parley.signAPIRequest(url,'GET',data);
    data.sig = sig;
    $.ajax({
      type:'GET',
      url:url,
      headers:{'Authorization' : 'Parley '+Parley.currentUser.get('email')+':'+data.sig, 'Sig-Time':data.time},
      data:data,
      success:finished,
      error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }

    // This function processes all of [Parley.alarms] (in parley.config.js) every [Parley.timerDelay] seconds.
    Parley.timer = function () {
        Parley.timerDelay = Parley.timerDelay || 300000;

        if (!Parley.pauseTimer)
            _.each(Parley.alarms, function (alarm) {
                if (alarm.when()) alarm.todo();
            });

        window.setTimeout(Parley.timer, Parley.timerDelay);
    }
    
    Parley.falseIsFalse = function (data) {
        console.log('\'false\' is false');
        
        var parsed_data = {};

        _.each(data, function (v,k) {
            if (v == 'false')
                v = false;

            if (k=='meta')
                _.each(JSON.parse(v), function (v,k) {
                    if (v == 'false')
                        v = false;
                    parsed_data[k] = v;
                });
            else
                parsed_data[k] = v;
        });

        return parsed_data;
    };

    Parley.formErrors = function (fname, errors) {
        if (!_.isObject(errors) || !document.forms[fname]) return false;

        var form = $(document.forms[fname]), err, errSpan;
        _.each(form.find('input'), function (v) {
            errSpan = $(v).parents('label').find('.error');
            if (err = errors[v.name]) {
                errSpan.text(err);
            } else {
                errSpan.text('');
            }
        });
    }
})(window.Parley = window.Parley || {});
