(function(Parley, $, undefined){
    Parley.vent = Parley.vent || _.extend({}, Backbone.Events);

    /**
    Builds Parley.contacts from the current user's keychain.

    @event contact:sync
    **/
    Parley.vent.on('contact:sync', function () {
        console.log('Populating contacts from keychain');
        for (var keychain=[], i=0, list=Parley.listKeys(), max=list.length; i<max; i++) {
            keychain.push(list[i]);
        }
        Parley.contacts.set(keychain, {parse:true});
    });

    /**
    Gets as much info about a contact as possible. This can take an email or fingerprint, with which it searches:

        a) Parley servers for an existing user, or; (if no user is found)
        b) public PGP key servers

    This will return as much information as it can find.

    @method getUserInfo
    @param {Object|String} contact Either an email string or an object containing at least one of _email_ or _fingerprint_ as properties.
    @param {Function} callback
    @return null
    **/
    Parley.getUserInfo = function (contact, callback) {
        callback = callback || function () {};

        if (typeof contact == 'string') {
            var email = contact;

            // Instantiated without arguments so as not to trigger a certain event
            contact = new Parley.Contact;

            contact.set({email:email});
        } else {
            var email = contact.get('email'),
                fingerprint = contact.get('fingerprint');
        }

        var planA = function(data) {
            console.log("A");
            if (!_.has(data, 'public_key')) {
                planB();
            } else {
                var key = Parley.importKey(data.public_key);
                var fingerprint = key.fingerprints[0];
                contact.set( _.extend(data, Parley.AFIS(fingerprint)) );
                callback(contact);
            }
        }
        var planB = function(data, textStatus) {
            console.log("B");
            if (!email && !fingerprint)
                callback({error: 'User not found'});

            fingerprint = fingerprint || Parley.requestPublicKey(email);
            var userinfo = Parley.AFIS(fingerprint);
            userinfo = _.isArray(userinfo) ? userinfo[0] : userinfo;

            if (!_.has(userinfo, 'uids')) {
                callback({error: 'User not found'});
            } else {
                var parsed = Parley.parseUID(userinfo.uids[0]);
                userinfo.name = parsed.name;
                userinfo.email = parsed.email;
                contact.set(userinfo);
                callback(contact);
            }
        }

        if (email) {
            return Parley.requestUser(email).success(planA).error(planB);
        } else {
            return planB();
        }
    }

    /**
    Gets info on a particular contact.

    @event contact:userinfo
    @param {Object} contact The contact on whom to get information.
    @param {Function} callback
    **/
    Parley.vent.on('contact:userinfo', function (data) {
        console.log('VENT: contact:userinfo');
        console.log('Checking user: ' + JSON.stringify(data.contact));

        contact = Parley.getUserInfo(data.contact, data.callback);
    });

    Parley.vent.on('contact:fetch', function (callback) {
        Parley.requestContacts(function (data) {
            if (data && !_.has(data, 'error')) {
                callback(data);
            } else {
                console.log(data.error);
            }
        });
    });

    /**
    Verify the email that the user submitted.

    This is the first event that gets triggered to begin the login/registration flow. 
    **/
    Parley.vent.on('setup:verify', function (formdata) {
        console.log('Verifying email address: ' + formdata.email);

        Parley.requestUser(formdata.email, function (data, textStatus) {
            if (_.isObject(data) && !_.has(data, 'error')) {
                console.log('User exists, setting up login form.');
                Parley.app.dialog('setup login', {
                    email: formdata.email
                });
            } else {
                console.log('User doesn\'t exists, showing registration form.');
                Parley.app.dialog('setup register', {
                    email: formdata.email
                });
            }
        });
    });

    Parley.vent.on('setup:register', function (formdata) {
        console.log('About to register user: ' + formdata.email);

        Parley.app.dialog('show info register-wait', { header: _t('registering'), message: _t('message-register-wait') });

        Parley.registerUser(formdata.name, formdata.email, formdata.password, formdata.send_key, function (data, textStatus, jqXHR) {
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
    });

    Parley.vent.on('setup:login', function (formdata) {
        console.log('VENT: setup:login');
        Parley.app.dialog('info login-wait', { header: _t('logging in'), message: _t('message-login-wait') });

        Parley.authenticateUser(formdata.email, formdata.password, function (data, textStatus) {
            if (!_.has(data, 'error')) {
                console.log('User successfully logged in.');

                var parsed_data = Parley.falseIsFalse(data);

                Parley.currentUser.set(parsed_data);

                Parley.vent.trigger('contact:sync');
                Parley.vent.trigger('message:sync');

                Parley.app.dialog('hide setup');
                Parley.app.dialog('hide info login-wait');

                Parley.app.render();

                // This next part is for the register flow, just here for testing
                Parley.app.dialog('show info inviteFriends', {
                    header: _t('invite your friends'),
                    message: _t('message-invitefriends'),
                    buttons: [
                        {
                            id: 'inviteFriends',
                            text: _t('okay'),
                            handler: function (e) {
                                e.preventDefault();
                                Parley.vent.trigger('contact:fetch', function (data) {
                                    console.log('fetched');
                                    Parley.app.dialog('hide info inviteFriends');
                                    Parley.app.dialog('show invite', { emails: data.contacts });
                                });
                            }
                        },
                        'cancel'
                    ]
                });
            } else {
                console.log('Login error occurred');

                Parley.app.dialog('hide info login-wait');
                Parley.app.dialog('info login-error', {
                    header: _t('error logging in'),
                    message: _t('error-login'),
                    buttons: ['okay']
                });
            }
        });
    });

    Parley.vent.on('message:sync', _.throttle(function () {
        console.log('VENT: message:sync');

        $('#refreshAction').attr('disabled', 'disabled').addClass('refreshing').animate({width:300,height:200,opacity:.5}).text( _t('loading inbox') );

        var fetchedInboxHandler = function (data, textStatus) {
            console.log('Inbox requested at offset: ' + Parley.inboxCurOffset + '.');

            if (data.error == 'FORBIDDEN') {
                console.log('error, forbidden inbox');

                Parley.app.dialog('info inbox-error', {
                    message: _t('error-inbox-forbidden'),
                    buttons: [ {
                        id: 'reconnectInbox',
                        text: _t('reconnect inbox'),
                        handler: function (e) {
                            e.preventDefault();
                            
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
                if (textStatus != 'localStorage') Parley.inboxCurOffset += 100;

                Parley.inbox = Parley.inbox || new MessageList;
                if (_.has(data, 'messages') && !!data.messages) {
                    console.log('Inbox: loaded ' + data.messages.length + ' messages.', data.messages);
                    for (var i = 0, t = data.messages.length; i<t; i++) {
                        Parley.inbox.add(data.messages[i], {parse:true});
                    }

                    if (Parley.inbox.length < (Parley.inboxCurPage * Parley.inboxPerPage))
                        Parley.vent.trigger('message:sync');
                    else
                        $('#refreshAction')
                            .removeAttr('disabled')
                            .removeClass('refreshing')
                            .animate({
                                width:200,
                                height:50,
                                opacity:1
                            })
                            .text( _t('refresh inbox') );
                } else {
                    console.log('End of mailbox');
                }

                if (Parley.inbox.length < (Parley.inboxCurPage * Parley.inboxPerPage))
                    Parley.vent.trigger('message:sync');
                else
                    $('#refreshAction')
                        .removeAttr('disabled')
                        .removeClass('refreshing')
                        .animate({
                            width:200,
                            height:50,
                            opacity:1
                        })
                        .text( _t('refresh inbox') );
            } else {
                // An error occurred
            }
        };
        var lsInbox = Parley.requestInbox(Parley.inboxCurOffset, fetchedInboxHandler);
        if (Parley.inbox.length == 0 && lsInbox.length > 0) fetchedInboxHandler({'messages':lsInbox});
    }, 5000));

    Parley.vent.on('message:nokey', function (data, callback) {
        console.log('Unknown emails in recipients list');

        var message = data.message,
            nokeys = data.nokeys,
            recipient;

        var nokeysBuilder = _.map(nokeys, function (ele, key) {
            var dfd = $.Deferred();

            Parley.getUserInfo(ele.email, function (recipient) {
                if (!recipient.error) {
                    message.recipients.push(recipient);
                    delete nokeys[key];
                }
                dfd.resolve();
            });

            return dfd.promise();
        });

        $.when.apply($, nokeysBuilder).then(function () {
            if (!_.isEmpty(nokeys)) {
                // Couldn't find public key, open invite dialog
                var nokeysHTML = _.reduce(nokeys, function (memo, val) {
                    return memo + '<li>' + val.email + '</li>';
                }, '<ul>') + '</ul>';
                Parley.app.dialog('show info nokey', {
                    message: _t('message-nokey'),
                    extra_html: nokeysHTML,
                    buttons: [ 
                        {
                            id: 'inviteDialogAction',
                            text: _t('invite'),
                            handler: function (e) {
                                e.preventDefault();
                                Parley.app.dialog('invite', { emails: nokeys });
                                Parley.app.dialog('hide info nokey');
                            }
                        },
                        'cancel'
                    ]
                });
            }
            if (!_.isEmpty(message.recipients)) Parley.vent.trigger('message:send', message, callback);
        }, function () {
            // This gets called if getUserInfo doesn't have a chance to fire the callback
            if (!_.isEmpty(nokeys)) {
                // Couldn't find public key, open invite dialog
                var nokeysHTML = _.reduce(nokeys, function (memo, val) {
                    return memo + '<li>' + val.email + '</li>';
                }, '<ul>') + '</ul><br>';
                Parley.app.dialog('show info nokey', {
                    message: _t('message-nokey'),
                    extra_html: nokeysHTML,
                    buttons: [ 
                        {
                            id: 'inviteDialogAction',
                            text: _t('invite'),
                            handler: function (e) {
                                e.preventDefault();
                                Parley.app.dialog('invite', { emails: nokeys });
                                Parley.app.dialog('hide info nokey');
                            }
                        },
                        'cancel'
                    ]
                });
            }
        });
    });

    Parley.vent.on('message:send', function (message, callback) {
        console.log('Sending email to: ' + JSON.stringify( message ));
        Parley.app.dialog('info send-message', { message: _t('message-message-sending') })

        Parley.encryptAndSend(message.subject, message.body, message.recipients, function (data, textStatus) {
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
                console.log('Message not sent.');
                Parley.app.dialog('info sent-message', {
                    message: _t('error-message-notsent'),
                    buttons: [ 'okay' ]
                });
                return false;
            }
        });
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

    Parley.vent.on('invite', function (emails, callback) {
        console.log('VENT: invite');
        callback = callback || function () {};

        if (_.isString(emails))
            emails = [emails];
        else if (!_.isArray(emails))
            return false;

        var inviteBuilder = _.map(emails, function (ele, key) {
            var dfd = $.Deferred();

            Parley.invite(ele, function (recipient) {
                if (!_.has(recipient, 'error'))
                    dfd.resolve();
            });

            return dfd.promise();
        });

        $.when.apply($, inviteBuilder).then(function () {
            callback();
        });
    });
}(window.Parley = window.Parley || {}, jQuery));
