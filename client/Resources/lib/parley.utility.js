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
 * for revoking keys (as well as searc/send-key), we'll need https://npmjs.org/package/hkp-client
 * */

(function (Parley) {

  Parley.BASE_URL = "https://api.parley.co";

  //TODO: node-webkit allows us to use node modules
  //var crypt = require('crypto');

  //openpgp.min.js must be included in index.html
  openpgp.init()

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
      finished();
  }

  /* Sign Parley API request--identical to Amazon API signing method,
  but timestamped and using password hash as the secret key. */
  Parley.signAPIRequest = function (url, method, data) {
    for (var key in data) {
      data[key] = ''+data[key];
    }
    return window.PYsignAPIRequest(url, method, data);
/* TODO:
    var valuePairs = _.pairs(data);
    var sorted = _.sortBy(valuePairs,function(i){return i[0]});
    var urlComponents = _.map(sorted,function(i){
      return encodeURIComponent(i[0]) + '=' encodeURIComponent(i[1]);
    });
    return crypto.createHmac(
        'SHA256',
        Parley.currentUser.get('passwords').local)
      .data(method+'|'+url+'?'+urlComponents.join('&'))
      .digest('base64')
      .replace('+','-')
      .replace('/','_')
      .replace('=','');
      */
  }

  Parley.pbkdf2 = function (data) {
    window.PYpbkdf2(data);
    /* TODO:
    var salt = Parley.currentUser.get('email') + '10620cd1fe3b07d0a0c067934c1496593e75994a26d6441b835635d98fda90db';
    return crypto.pbkdf2Sync(data, salt.toLowerCase(), 2048, 32).toString('hex');
    */
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
        var uid = Parley.currentUser.get('name') + ' () '
          + Parley.currentUser.get('email');
        openpgp.generate_key_pair(1,4096,uid,
          Parley.currentUser.get('passwords').local);
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
        a.revoked = window.PYrevokeKey(); //TODO with openpgpjs
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
            window.PYimportEncryptedKeyring(data.keyring); //TODO with openpgpjs
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
        window.PYchangeName(data.name); //TODO with openpgpjs
        data.keyring = window.PYgetEncryptedKeyring(); //TODO
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
    var keyring = window.PYgetEncryptedKeyring(), //TODO with openpgpjs
        finished = finished || function () {};
    Parley.saveUser({'keyring':keyring, 'public_key':window.PYgetPublicKey() /* TODO with openpgpjs */}, finished);
  }, 1000*3);
  
  /* Requests the public key corresponding to an email address from public keyservers.
  This function can take a bit of time to execute.
  Accepts email address, returns key fingerprint on success or null on failure. */
  //NB. Although this function is called by several others to allow strings to
  //be used in place of Contact objects (ie. the encrypt and decrypt functions)
  //it is probably better to create Contact objects using this function first
  //and then pass the entire object to encrypt/decrypt/etc. (See Parley.AFIS)
  Parley.requestPublicKey = function(email) {
    return window.PYfetchKey(email); //TODO with openpgpjs
  }

  Parley.importKey = Parley.importPublicKey = Parley.importSecretKey = function(key) {
    return window.PYimportKey(key); //TODO with openpgpjs
  }

  Parley.changePass = function(oldPass, newPass, finished) {
    if (Parley.pbkdf2(oldPass) == Parley.currentUser.get('passwords').local) { //this is extremely superficial (because PWs are already in memory) but hopefully will at least reduce the likelihood of situations like "my little brother saw Parley open and decided to change my password"
      var oldLocal, newLocal, oldRemote, newRemote, passwords = Parley.currentUser.get('passwords');
      oldLocal = passwords.local;
      oldRemote = passwords.remote;
      passwords.local = newLocal = Parley.pbkdf2(newPass);
      passwords.remote = newRemote = Parley.pbkdf2(newLocal);
      window.PYchangePass(newLocal); //TODO //change keyring passphrase

      //update passwords on server along with keyring
      var email = Parley.currentUser.get('email');
      var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(email);
      var keyring = window.PYgetEncryptedKeyring(); //TODO
      var data = {'time': Math.floor((new Date())/1000), 'keyring': keyring, 'public_key':window.PYgetPublicKey() /* TODO */,'secret':newRemote};

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
  Parley.listKeys = function() {
    return window.PYlistKeys(); //TODO  with openpgpjs
  }

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

    //TODO
    var messageText = window.PYencryptAndSign(clearTextMessage, recipientKeys, Parley.currentUser.get('fingerprint'), Parley.currentUser.get('passwords').local);

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
    //TODO
    return window.PYdecryptAndVerify(encryptedMessage, Parley.currentUser.get('passwords').local, keyid);
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
