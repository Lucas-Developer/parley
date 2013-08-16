/*

   Here are some newer miscellaneous notes about Parley while they're on my mind:
   
   -we need to think about what data, if any, we'll persist between uses
     -ie. does a user stay logged in if they open/close the app? Are contacts
     stored in localStorage or regenerated from the keyring every time?
     -I'm tempted to err towards the least storage possible until we consider
     the usability/security tradeoffs at hand
     -Note that the keyring itself will generally stay on the clients as a separate (encrypted) file, as per gpg's typical behaviour
   -I added parley.listKeys() to list every public key in a keyring--we could
   easily use that to build a contact list every time the user logs in. Here's
   some sample output for a single key:
     
     [
       {
         "dummy": "",
         "keyid": "5CA687A5B91D848E",
         "expires": "1372256185",
         "subkeys": [
           [ "E45C139F7291E0F6", "e" ]
         ],
         "length": "2048",
         "ownertrust": "-",
         "algo": "1",
         "fingerprint": "B1E44BDDB11E03815D9CEE435CA687A5B91D848E",
         "date": "1371651385",
         "trust": "-",
         "type": "pub",
         "uids": [ "Jim John <test@example.com>" ]
       }
     ]

     -uids take the form "First Name (Optional comment here) <email@example.com>"
       -it probably makes sense to pull names and email addresses from the uid with a regex in order to build the Contact model

   -I've taken some care to make these functions accept email addresses and Contact objects interchangeably, but it probably makes sense to build Contact objects from email addresses before calling the functions (see note on Parley.requestPublicKey)

   ---------------Older Note:--------------------
Methods and data models
Parley.setup (stores IMAP credentials and downloads encrypted keyring from Parley server)
Parley.contacts (collection)
Parley.inbox (collection)
  .fetch retrieves paginated list of PGP encrypted mail (and unencrypted messages from Parley, ie. for
  verification), both sent and received, ordered by time via IMAP (using context.io)

The client should walk the user through a setup process on initial use (or after logging out) that
involves getting the user's email address and checking to see if it is registered with Parley. If so,
the program should accept the user's password and retrieve the keyring from the Parley server. Otherwise,
the program should create a new account for the user and generate a keypair.

The setup process also needs to collect and store (locally) the user's IMAP credentials.

There should be a settings panel where the user can change their password, IMAP credentials or log out.

There should be a "Contacts" panel (separate from the one that pops up while composing a message) where
the user can manage their contacts and invite new users to Parley.

--------------General docstring:--------------

The following utilities will encapsulate any external Python calls (ie. for crypto/key management) and
remote API calls (IMAP/SMTP/Parley).

NB. I've replaced jQuery's usual success and error callbacks with a single
"finished" callback. It has the same signature as jQuery's success; errors
are massaged to fit. The arguments to finished on ajax error look like:
  {'error':ErrorString},textStatus,jqXHR
*/

(function (Parley) {

  Parley.BASE_URL = "https://api.parley.co";

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
      result = window.PYinstalled(
          window.Ti.Filesystem.getResourcesDirectory().toString(),
          window.Ti.Filesystem.getApplicationDataDirectory().toString(),
          window.Ti.Filesystem.getUserDirectory().toString()
      );
      return result
  }
  Parley.install = function(finished){
      window.PYinstall(
          window.Ti.Filesystem.getResourcesDirectory().toString(),
          window.Ti.Filesystem.getApplicationDataDirectory().toString(),
          window.Ti.Filesystem.getUserDirectory().toString()
      );
      finished();
  }

  /* Sign Parley API request--identical to Amazon API signing method,
  but timestamped and using password hash as the secret key. */
  Parley.signAPIRequest = function (url, method, data) {
    //cast all data values as strings, because tide's KObject transfer layer
    //was changing ints to floats and breaking the signatures
    for (var key in data) {
      data[key] = ''+data[key];
    }
    return window.PYsignAPIRequest(url, method, data);
  }

  Parley.pbkdf2 = function (data) {
    return window.PYpbkdf2(data);
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
        window.PYgenKey(sendKey); //this is super slow
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
        data:{'time':time,'sig':sig},
        success:function(data, textStatus, jqXHR) {
          if (data.keyring) {
            window.PYimportEncryptedKeyring(data.keyring);
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
  
  /* Stores (encrypted) local keyring on the server.
  Accepts finished callback. */
  Parley.storeKeyring = _.debounce(function(finished) {
    if (!Parley.currentUser) {
      throw "Error: There is no currently authenticated user.";
    } else {
      var email = Parley.currentUser.get('email');
      var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(email);
      var keyring = window.PYgetEncryptedKeyring();
      var data = {'time': Math.floor((new Date())/1000), 'keyring':keyring, 'public_key':window.PYgetPublicKey()};
      var sig = Parley.signAPIRequest(url,'POST',data);
      data.sig = sig;
      $.ajax({
        type:'POST',
        url:url,
        data:data,
        success:finished,
        error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
        dataType:'json'
      });
    }
  }, 1000*3);
  
  /* Requests the public key corresponding to an email address from public keyservers.
  This function can take a bit of time to execute.
  Accepts email address, returns key fingerprint on success or null on failure. */
  //NB. Although this function is called by several others to allow strings to
  //be used in place of Contact objects (ie. the encrypt and decrypt functions)
  //it is probably better to create Contact objects using this function first
  //and then pass the entire object to encrypt/decrypt/etc. (See Parley.AFIS)
  Parley.requestPublicKey = function(email) {
    return window.PYfetchKey(email);
  }

  Parley.importKey = Parley.importPublicKey = Parley.importSecretKey = function(key) {
    return window.PYimportKey(key);
  }

  Parley.changePass = function(oldPass, newPass, finished) {
    if (Parley.pbkdf2(oldPass) == Parley.currentUser.get('passwords').local) { //this is extremely superficial (because PWs are already in memory) but hopefully will at least reduce the likelihood of situations like "my little brother saw Parley open and decided to change my password"
      var oldLocal, newLocal, oldRemote, newRemote, passwords = Parley.currentUser.get('passwords');
      oldLocal = passwords.local;
      oldRemote = passwords.remote;
      passwords.local = newLocal = Parley.pbkdf2(newPass);
      passwords.remote = newRemote = Parley.pbkdf2(newRemote);
      window.PYchangePass(newLocal); //change keyring passphrase
      //update passwords on server along with keyring
      var email = Parley.currentUser.get('email');
      var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(email);
      var keyring = window.PYgetEncryptedKeyring();
      var data = {'time': Math.floor((new Date())/1000), 'keyring':keyring, 'public_key':window.PYgetPublicKey(),'secret':newRemote};
      var sig = Parley.signAPIRequest(url,'POST',data);
      data.sig = sig;
      $.ajax({
        type:'POST',
        url:url,
        data:data,
        success:function(a,b,c){
          Parley.currentUser.set('passwords',passwords);
          finished(a,b,c);
        },
        error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
        dataType:'json'
      });
    }
  }

  Parley.killUser = function(finished) {
    var url = Parley.BASE_URL+'/u/'+Parley.encodeEmail(Parley.currentUser.get('email'));
    var data = {};
    data.sig = Parley.signAPIRequest(url, 'DELETE', data);
    $.ajax({
      type:'DELETE',
      url:url,
      data:data,
      success:function(a,b,c) {
        a.revoked = window.PYrevokeKey();
        if (!a.revoked) {
          a.error = 'Failed to revoke key';
        }
        finished(a,b,c);
      },
      error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }

  //This function could be used to build Parley.Contacts from a keyring
  //after importing it or adding a new key.
  Parley.listKeys = function() {
    return window.PYlistKeys();
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
  Parley.requestInbox = function(finished, offset) {
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
      data:data,
      success:finished,
      error:function(jqXHR,textStatus,errorString){finished({'error':errorString},textStatus,jqXHR)},
      dataType:'json'
    });
  }

}(window.Parley = window.Parley || {}));
