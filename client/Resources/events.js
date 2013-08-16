(function(Parley, $, undefined){
    Parley.vent = Parley.vent || _.extend({}, Backbone.Events);

    Parley.vent.on('contact:sync', function (e) {
        console.log('Populating contacts from keychain');
        for (var keychain=[], i=0, list=Parley.listKeys(), max=list.length; i<max; i++) {
            keychain.push(list[i]);
        }
        Parley.contacts.set(keychain, {parse:true});
    });

    Parley.vent.on('contact:add', function (contact, callback) {
        console.log('VENT: contact:add');
        var callback = callback || function () {};

        var form = document.forms.newcontact;

        Parley.app.dialog('contacts contactlist');
        Parley.vent.trigger('contact:userinfo', {email:form.contact_email.value, name:form.contact_name.value});
    });

    Parley.vent.on('contact:userinfo', function (contact, callback) {
        console.log('VENT: contact:userinfo');
        var callback = callback || function () {};
        var email = contact.get('email');

        var planA = function(userinfo) {
            console.log("A");
            if (!_(userinfo).has('public_key')) {
                planB();
            } else {
                var key = Parley.importKey(userinfo.public_key);
                var fingerprint = key.fingerprints[0];
                contact.set( _.extend(userinfo, Parley.AFIS(fingerprint)) );
                if (!Parley.contacts.findWhere({email: userinfo.email}))
                    Parley.contacts.add(contact);
            }
            Parley.storeKeyring(console.log);
        }
        var planB = function(data, textStatus) {
            console.log("B");
            var fingerprint = contact.get('fingerprint') || Parley.requestPublicKey(email);
            var userinfo = Parley.AFIS(fingerprint);

            userinfo = _.isArray(userinfo) ? userinfo[0] : userinfo;

            if (!_(userinfo).has('uids')) {

            } else {
                var parsed = Parley.parseUID(userinfo.uids[0]);
                userinfo.name = parsed.name;
                userinfo.email = parsed.email;
                contact.set(userinfo);
                if (!Parley.contacts.findWhere({email: userinfo.email}))
                    Parley.contacts.add(contact);
            }
            Parley.storeKeyring(console.log);
        }
        if (email) {
            Parley.requestUser(email, callback).success(planA).error(planB);
        } else {
            planB();
        }
    });

    Parley.vent.on('setup:verify', function (e, callback) {
        e.preventDefault();
        var form = document.forms.emailVerify;

        if (_.isUndefined(form.email.value)) return false;
        console.log('Verifying email address: ' + form.email.value);

        Parley.requestUser(form.email.value, function (data, textStatus) {
            if (_.isObject(data) && !_.has(data, 'error')) {
                console.log('User exists, setting up login form.');
                Parley.app.dialog('setup login', {
                    email: form.email.value
                });
            } else {
                console.log('User doesn\'t exists, showing registration form.');
                Parley.app.dialog('setup register', {
                    email: form.email.value
                });
            }
        });
    });

    Parley.vent.on('setup:register', function (e, callback) {
        e.preventDefault();
        var form = document.forms.registerAction;

        if (form.password_one.value != form.password_two.value) {
            // Passwords don't match
            console.log('Passwords don\'t match.');
            Parley.app.dialog('show info no-match', { header: _t('password mismatch'), message: _t('error-password-nomatch'), buttons: [ 'okay' ] });
        } else {
            console.log('About to register user: ' + form.email.value);

            Parley.app.dialog('show info register-wait', { header: _t('registering'), message: _t('message-register-wait') });

            Parley.registerUser(form.name.value, form.email.value, form.password_two.value, form.send_key.checked, function (data, textStatus, jqXHR) {
                console.log(JSON.stringify(data), textStatus, data.error);

                if (!_.has(data, 'error')) {
                    console.log('New user successfully registered with email: ' + Parley.currentUser.get('email'));
                    console.log('Registering new inbox with Context.io');

                    Parley.registerInbox();
                    Parley.waitForRegisteredInbox(function(success) {
                        Parley.app.dialog('hide info inbox-error');
                        _.delay(function(){ Parley.vent.trigger('message:sync'); }, 5000);
                    });

                    Parley.app.dialog('hide setup');
                    Parley.app.dialog('hide info register-wait');
                    Parley.app.render();
                } else {
                    Parley.app.dialog('hide info register-wait');
                    Parley.app.dialog('info register-error', {
                        header: 'Error',
                        message: _t('error-register'),
                        buttons: [ 'okay' ]
                    });
                    console.log('Error registering');
                    console.log(textStatus);
                }
            });
        }
    });
    Parley.vent.on('setup:login', function (e, callback) {
        e.preventDefault();
        var form = document.forms.loginAction,
            email = form.email.value,
            password = form.password.value;

        Parley.app.dialog('info login-wait', { header: _t('logging in'), message: _t('message-login-wait') });

        Parley.authenticateUser(email, password, function (data, textStatus) {
            if (!_.has(data, 'error')) {
                console.log('User successfully logged in.');

                Parley.currentUser.set(data);

                Parley.vent.trigger('contact:sync');
                Parley.vent.trigger('message:sync');

                Parley.app.dialog('hide setup');
                Parley.app.dialog('hide info login-wait');
                Parley.app.render();
            } else {
                Parley.app.dialog('hide info login-wait');
                Parley.app.dialog('info login-error', {
                    header: _t('error logging in'),
                    message: _t('error-login'),
                    buttons: ['okay']
                });
            }
        });
    });

    Parley.vent.on('message:sync', function (e, callback) {
        console.log('VENT: message:sync');
        Parley.app.dialog('info inbox-loading', { header: _t('loading inbox'), message: _t('message-inbox-loading') });
        Parley.requestInbox(function (data, textStatus) {
            if (data.error == 'FORBIDDEN') {
                console.log('error, forbidden inbox');

                Parley.app.dialog('hide info inbox-loading');
                Parley.app.dialog('info inbox-error', {
                    message: _t('error-inbox-forbidden'),
                    buttons: [ {
                        id:'retryInbox',
                        text:'Retry',
                        handler: function(e) {
                            Parley.registerInbox();
                            Parley.waitForRegisteredInbox(function(success) {
                                Parley.app.dialog('hide info inbox-error');
                                _.delay(function(){Parley.vent.trigger('message:sync');},1000);
                            });
                        }
                    } ]
                });

                return false;
            } else if (!_.has(data, 'error')) {
                console.log('Inbox loaded', data.messages);
                Parley.app.dialog('hide info inbox-loading');

                Parley.inbox = Parley.inbox || new MessageList;
                if (_.has(data, 'messages')) {
                    for (var i = 0, t = data.messages.length; i<t; i++) {
                        Parley.inbox.add(data.messages[i], {parse:true});
                    }
                }
            } else {
                // An error occurred
            }
        });
    });

    Parley.vent.on('message:send', function (e, callback) {
        e.preventDefault();

        var formdata = $('#composeForm').serializeArray();

        var recipients = [], nokeyRecipients = [];
        var recipient = _.findWhere(formdata, {name:'as_values_to'}),
            subject = _.findWhere(formdata, {name:'subject'}),
            body = _.findWhere(formdata, {name:'body'});
        
        _.each(recipient.value.split(','), function (ele, i) {
            if (recipient = Parley.contacts.findWhere({email:ele}))
                recipients.push(recipient);
            else if (!_.isEmpty(ele))
                nokeyRecipients.push({email:ele});
        });

        console.log('Sending email to: ', recipients);
        Parley.app.dialog('info send-message', { message: _t('message-message-sending') })
        
        if (!_.isEmpty(recipients)) {
            Parley.encryptAndSend(subject.value, body.value, recipients, function (data, textStatus) {
                if (textStatus != 'error') {
                    console.log('Message successfully sent.');
                    console.log( JSON.stringify(data) );
                    Parley.app.dialog('hide compose');
                    Parley.app.dialog('hide info send-message');
                    Parley.app.dialog('info sent-message', {
                        message: _t('message-message-sent'),
                        buttons: [ 'okay' ]
                    });
                } else {
                    // Error
                    alert('We encountered an error sending your email.');
                    return false;
                }
            });
        } else {
            alert('You have not entered any valid email addresses! Recipients must have a PGP key associated with their email address.');
            return false;
        }

        /*
        if (nokeyRecipients.length > 0) {
            console.log('We have no keys for these recipients: ', nokeyRecipients);
            Parley.app.dialog('setup nokey', {emails:nokeyRecipients});
        }
        */
    });

    Parley.vent.on('user:kill', function (callback) {
        console.log('VENT: user:kill');
        callback = callback || function () {};

        Parley.app.dialog('show info revoke-confirm', {
            message: _t('message-key-revokeconfirm'),
            buttons: [ {
                id: 'confirmRevokeKeyAction',
                text: _t('confirm'),
                handler: function () {
                    Parley.killUser(function (data, status) {
                        Parley.app.dialog('hide info revoke-confirm');
                        if (!_.has(data, 'error')) {
                            Parley.app.kill();
                        } else {
                            Parley.app.dialog('show info revoke-info', {
                                message: _t('message-key-revokeerror'),
                                buttons: [ 'okay' ]
                            });
                        }
                    });
                }
            }, 'cancel' ]
        });
    });

/*
        inviteAction: function (e) {
            var email,selected = this.$('.selector a.clicked').parent();
            selected.each(function (i,e) {
                var $e = $(e);
                email = $e.find('.email').text();
                Parley.invite(email, function () {});
            });
        }
*/
}(window.Parley = window.Parley || {}, jQuery));
