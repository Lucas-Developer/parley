(function(Parley) {

  //This is a really shitty automated test script in lieu of setting up a proper framework.
  //Testing is complicated by network requirements...

  Parley.testPYutilities = function() {

    console.log("Start testing Python utilitiess:");
    console.log("Assume PYsetup has run successfully, aka gpg is installed.");
    console.log("We won't test PYgenKey, because that sends keys to public keyservers");
    console.log("Assume window.Parley.currentUser exists.");
    var userAttributes = _.clone(Parley.currentUser.attributes);
    var testUserAttributes = _.clone(Parley.currentUser.attributes);
    _.extend(testUserAttributes, {
      'email':'dave@blackchair.net'
      'passwords': {
        'local': 'cbad88e859e55cb865a1be9ebb6a61b2905a9cda169b225b9ae4c620e0d18138',
        'remote': '9700baf89772b38d54d880294237dd6fd42a5fca91ff97161a29bce864b838d0'
      }
    });

    console.log("Testing PYlistKeys...");
      var keys = window.PYlistKeys();
      if (keys) { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

    console.log("Testing PYgetPublicKey...");
      var pub_key = window.PYPublicKey();
      if (pub_key) { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

    console.log("Testing PYgetEncryptedKeyring...");
      var enc_kr = window.PYgetEncryptedKeyring();
      if (enc_kr) { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

    console.log("Testing PYclearKeys...");
      window.PYclearKeys();
      var empty = window.PYlistKeys();
      if (empty.length === 0) { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

    console.log("Testing PYfetchKey...");
      window.PYclearKeys();
      window.PYfetchKey('dave@blackchair.net');
      var one = window.PYlistKeys();
      if (one.length === 1) { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

    console.log("Testing PYimportKey...");
      window.PYclearKeys();
      window.PYimportKey(pub_key);
      var one = window.PYlistKeys();
      if (one.length === 1) { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

    console.log("Testing PYimportEncryptedKeyring...");
      window.PYimportEncryptedKeyring(enc_kr);
      var new_keys = window.PYlistKeys();
      if (keys.length === new_keys.length) { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

    console.log("Testing PYsignAPIRequest...");
      var sig = window.PYsignAPIRequest('https://example.com','GET',{'test':'data'});
      if (sig == "mA4rV1l3WosZKHE8DWsBx5I24ntkuy%2FKTnpuWDwgDR8%3D") { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

    console.log("Testing PYpbkdf2...");
      Parley.currentUser.attributes = testUserAttributes;
      var hash = PYpbkdf2('test');
      if (hash == "041b161d39989724d7098bbf9840e33d844c91bf8b97522c8cc35477c3cd7319") { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }
      Parley.currentUser.attributes = userAttributes;

    console.log("Testing PYencryptAndSign...");
      var fp = Parley.currentUser.get('fingerprint');
      var pw = Parley.currentUser.get('passwords').local;
      var encrypted = window.PYencryptAndSign('hello',fp,fp,pw);
      if (encrypted) { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }
    console.log("Testing PYdecryptAndVerify...");
      var decrypted = window.PYdecryptAndVerify(encrypted,pw,fp);
      if (decrypted == 'hello') { console.log("[ OK ]"); }
      else { console.log("[ failed ]"); }

  }

})(window.Parley = window.Parley ||  {});
