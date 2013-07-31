(function(Parley, $, undefined){
    /*
    These first two statements could be moved, but I put them here for now.
    */
    $.fn.serializeObject = function() {
        var o = {};
        var a = this.serializeArray();
        $.each(a, function() {
            if (o[this.name] !== undefined) {
                if (!o[this.name].push) {
                    o[this.name] = [o[this.name]];
                }
                o[this.name].push(this.value || '');
            } else {
                o[this.name] = this.value || '';
            }
        });
        return o;
    };
	WebFont.load({
	    google: {
		families: ['Source Sans Pro', 'PT Sans', 'PT Serif']
	    }
	});

    Parley.i18n = Backbone.Model.extend({
        defaults: function () {
            return {
                lang: 'en'
            }
        },
        dict_files: {
            // Make sure the actual files are '.json'
            en: 'dict.en',
            fr: 'dict.fr'
        },
        dict_path: 'lang/',
        initialize: function (l,p) {
            // Freeze up the app for the split second it takes to load
            // the first language files
            this.loadDictionary({lang:'en',sync:true});
        },
        loadDictionary: function (opts) {
            var lang = opts.lang || Parley.currentUser && Parley.currentUser.get('lang') || 'en';
            var path = opts.path || this.dict_path + this.dict_files[lang] || dict_path + 'dict.en';
            var model = this;

            $.ajax({
                type: 'GET',
                async: !opts.sync,
                url: path + '.json',
                success: function (dict) {
                    $.i18n.setDictionary(dict);
                },
                dataType: 'json'
            });
        },
        _t: function (message) {
            return $.i18n._(message);
        }
    });

    /** This should be moved to a new file or something
        it's basically a bunch of events. EVENTually I think
        all of the events can go through this in some way.
    **/
    Parley.vent = _.extend({}, Backbone.Events);

    Parley.vent.on('contact:sync', function (e) {
        console.log('Populating contacts from keychain');
        for (var keychain=[], i=0, list=Parley.listKeys(), max=list.length; i<max; i++) {
            keychain.push(list[i]);
        }
        Parley.contacts.set(keychain, {parse:true});
    });

    Parley.vent.on('contact:userinfo', function (contact, callback) {
        console.log('VENT: contact:userinfo');
        var callback = callback || function () {};

        // Gotta have either an email or a fingerprint.
        // Will just fail silently if it gets neither
        var email = contact.get('email');

        var planA = function(userinfo) {
            if (!_(userinfo).has('public_key')) {
                planB();
            } else {
                var key = Parley.importKey(userinfo.public_key);
                var fingerprint = key.fingerprints[0];
                contact.set( _.extend(userinfo, Parley.AFIS(fingerprint)) );
                if (Parley.currentUser.get('email') != email) Parley.contacts.add(contact);
            }
        }
        var planB = function() {
            var fingerprint = contact.get('fingerprint') || Parley.requestPublicKey(email);
            var userinfo = Parley.AFIS(fingerprint);

            userinfo = _.isArray(userinfo) ? userinfo[0] : userinfo;

            if (!_(userinfo).has('uids')) {

            } else {
                var parsed = Parley.parseUID(userinfo.uids[0]);
                userinfo.name = parsed.name;
                userinfo.email = parsed.email;
                contact.set(userinfo);
                if (Parley.currentUser.get('email') != email) Parley.contacts.add(contact);
            }
        }
        Parley.requestUser(email, callback).success(planA).error(planB);
    });

    Parley.vent.on('setup:verify', function (e, callback) {
        e.preventDefault();
        var form = document.forms.emailVerify;

        if (_.isUndefined(form.email.value)) return false;
        console.log('Verifying email address: ' + form.email.value);

        Parley.requestUser(form.email.value, function (data, textStatus) {
            if (_.isObject(data) && !_.has(data, 'error')) {
                console.log('User exists, setting up login form.');
                Parley.app.dialog('setup login', {email: form.email.value, message: Parley.app.i18n._t('login') });
            } else {
                console.log('User doesn\'t exists, showing registration form.');
                Parley.app.dialog('setup register', {email: form.email.value, message: Parley.app.i18n._t('register') });
            }
        });

    });
    Parley.vent.on('setup:register', function (e, callback) {
        e.preventDefault();
        var form = document.forms.registerAction;

        if (form.password_one.value != form.password_two.value) {
            // Passwords don't match
            console.log('Passwords don\'t match.');
        } else {
            console.log('About to register user: ' + form.email.value);

            Parley.app.dialog('info register-wait', { message: Parley.app.i18n._t('register-wait') });
            Parley.app.dialog('hide setup');

            Parley.registerUser(form.name.value, form.email.value, form.password_two.value, function (data, textStatus) {
                console.log(JSON.stringify(data), textStatus, data.error);

                if (textStatus != 'error') {
                    console.log('New user successfully registered with email: ' + Parley.currentUser.get('email'));
                    console.log('Registering new inbox with Context.io');
                
                    Parley.registerInbox();

                    Parley.app.loadUser();
                    Parley.app.dialog('hide info register-wait');
                } else {
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

        Parley.app.dialog('hide setup');
        Parley.app.dialog('info login-wait', { message: Parley.app.i18n._t('login-wait') });

        Parley.authenticateUser(email, password, function (data, textStatus) {
            console.log('User successfully logged in.');
            Parley.app.dialog('hide info login-wait');
            Parley.app.loadUser();
        });
    });

    Parley.vent.on('message:sync', function (e, callback) {
        console.log('VENT: message:sync');
        Parley.app.dialog('info inbox-loading', { message: Parley.app.i18n._t('loading-inbox') });
        Parley.requestInbox(function (data, textStatus) {
            if (data.error == 'FORBIDDEN') {
                console.log('error, forbidden inbox');

                Parley.app.dialog('hide info inbox-loading');
                Parley.app.dialog('info inbox-error', {
                    message: Parley.app.i18n._t('inbox-forbidden'),
                    buttons: [
                        {id:'retryInbox',text:'Retry'}
                    ],
                    events: {
                        'click #retryInbox': function(e) {
                            Parley.app.dialog('hide info inbox-error');
                            Parley.app.dialog('info inbox-loading', { message: Parley.app.i18n._t('loading-inbox') });
                            Parley.registerInbox();
                            Parley.vent.trigger('message:sync'); }
                    }
                });

                return false;
            } else {
                console.log('Inbox loaded', data.messages);
                Parley.app.dialog('hide info inbox-loading');

                Parley.inbox = Parley.inbox || new MessageList;
                if (_.has(data, 'messages')) {
                    for (var i = 0, t = data.messages.length; i<t; i++) {
                        Parley.inbox.add(data.messages[i], {parse:true});
                    }
                }
            }
        });
    });

    Parley.vent.on('message:send', function (e, callback) {
        e.preventDefault();

        var formdata = $('#composeForm').serializeObject();

        var recipients = [], nokeyRecipients = [];
        //var recFields = ['as_values_to', 'as_values_cc', 'as_values_bcc'];
        var recFields = ['as_values_to'];
        // This can be done more efficiently, probably
        _.each(recFields, function (fName) {
            if (!_.isEmpty(formdata[fName])) {
                _.each(formdata[fName].split(','), function (ele, i) {
                    var recipient = Parley.contacts.findWhere({email:ele});
                    if (recipient)
                        recipients.push(recipient);
                    else if (!_.isEmpty(ele))
                        nokeyRecipients.push({email:ele});
                });
            }
        });

        console.log('Sending email to: ', recipients);
        Parley.app.dialog('info send-message', { message: Parley.app.i18n._t('send-message') })
        
        if (!_.isEmpty(recipients)) {
            Parley.encryptAndSend(formdata.subject, formdata.body, recipients, function (data, textStatus) {
                if (textStatus != 'error') {
                    console.log('Message successfully sent.');
                    console.log( JSON.stringify(data) );
                    Parley.app.dialog('hide compose');
                    Parley.app.dialog('hide send-message');
                    Parley.app.dialog('info sent-message', {
                        message: Parley.app.i18n._t('sent-message'),
                        buttons: [ { id: 'closeDialog', text: 'Okay' } ],
                        events: { 'click #closeDialog': function (e) { Parley.app.dialog('hide sent-message'); } }
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

/*
        inviteAction: function (e) {
            var email,selected = this.$('.selector a.clicked').parent();
            selected.each(function (i,e) {
                var $e = $(e);
                email = $e.find('.email').text();
                Parley.invite(email, function () {});
            });
        },
        retryInbox: function (e) {
            Parley.app.loadUser();
        },
        newContact: function () {
            this.setPage('newcontact');
        },
        addContact: function (e) {
            e.preventDefault();

            // Form validation should go here
            var formdata = $(document.forms.newcontact).serializeObject();
            var newContact = new Parley.Contact(formdata);
            //Parley.vent.trigger('contact:userinfo', newContact);
            this.setDialog('loading', {message:'saving-contacts'});

            Parley.storeKeyring(_.bind(function(){
                this.setDialog('contacts');
            }, this));
        }
*/
    /** END VENT CODE **/

	Parley.BaseView = Backbone.View.extend({
		assign: function (view, selector) {
			view.setElement(this.$(selector)).render();
		}
	});

	Parley.Contact = Backbone.Model.extend({
	    defaults: function () {
			return {
				last_received: 0,
				last_sent: 0,
				thumbnail: false,
				count: 0,
                messages: []
			}
	    },
        initialize: function (attrs) {
            console.log('Initializing contact.');

            Parley.vent.trigger('contact:userinfo', this);
        },
        addMessage: function (message) {
            message = message.toJSON ? message.toJSON() : message;
            this.set({
                last_received: this.attributes.last_received + 1,
                count: this.attributes.count + 1
            });
            //this.get('messages').push(message);

            return this;
        }
	});

	var ContactList = Backbone.Collection.extend({
	    model: Parley.Contact
	});
	var ContactView = Parley.BaseView.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#contactTemplate').html()),
	    events: {
            "click .send" :     "sendMessage"
        },
		render: function () {
			var data = this.model.toJSON();

            this.listenTo(this.model, 'change', this.render);

			this.$el.addClass('contact').html(this.template(data));
			return this;
	    },
        sendMessage: function () {
            Parley.app.dialog('compose', {from:this.model});
        }
	});

	Parley.Message = Backbone.Model.extend({
        defaults: function () {
            return {
                from: {},
                subject: '',
                selected: false
            };
        },
        initialize: function () {
            var data = this.toJSON();
            var from = data.addresses.from;
            var from_obj = Parley.contacts.findWhere({email: from.email});

            if (!from_obj) {
                console.log('Creating contact from scratch.');

                from_obj = new Parley.Contact(from);
            }

            if (_.has(data.person_info, from.email)) from_obj.set('thumbnail', data.person_info[from.email].thumbnail);

            this.set('from', from_obj.addMessage(this));

            // If it's not encrypted, we can just populate the decrypted message array
            this.decryptedMessage = this.decryptedMessage || [];
/*
            _.each(data.body, function (v,k) {
                if (v.type == 'text/plain' && !!~v.content.indexOf('-----BEGIN PGP MESSAGE-----'))
                    this.decryptedMessage.push(v.content);
            }, this);
*/
        },
        readMessage: function (parseLinks, insertBRs, quote) {
            // parseLinks is an optional boolean for whether or not to convert URLs to HTML anchors
            // insertBRs is an optional boolean for replacing carriage returns with HTML line breaks
            // quote is an optional boolean for returning the message in quoted form (for reply box)

            //***: Not sure why decryptedMessage should be an array; there will only be one per Message?
            //
            parseLinks = _.isUndefined(parseLinks); //default is true
            insertBRs = _.isUndefined(insertBRs) ? parseLinks : insertBRs; //default same as parseLinks
            quote = _.isUndefined(quote) ? !parseLinks : quote; //default opposite of parseLinks

            if (this.decryptedMessage.length > 0) {
                console.log('Reading message from memory.');
                var msg = this.decryptedMessage[0];
                if (quote) msg = Parley.quote(msg);
                if (window.linkify && parseLinks) msg = linkify(msg);
                if (insertBRs) msg = Parley.insertBRs(msg);
                return [msg];
            } else {
                // This needs some error handling, must be bird-ass tight
                console.log('Decrypting message.');
                var sender = this.get('from');
                this.decryptedMessage = this.decryptedMessage || [];
                _.each(this.get('body'), _.bind(function (v,k) {
                    this.decryptedMessage.push(Parley.decryptAndVerify(v.content, this.get('from')));
                }, this));
                var msg = this.decryptedMessage[0];
                if (quote) msg = Parley.quote(msg);
                if (window.linkify && parseLinks) msg = linkify(msg);
                if (insertBRs) msg = Parley.insertBRs(msg);
                return [msg];
            }
        },
        toggleSelect: function () {
            this.set({'selected': !this.get('selected')});
            return this.get('selected');
        }
	});

	var MessageList = Backbone.Collection.extend({
	    model: Parley.Message
	});
	var MessageView = Parley.BaseView.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#messageTemplate').html()),
	    events: {
            'click .from':          'openContact',
			'click .subject':		'openMessage',
            'click .selector':      'toggleSelect'
	    },
	    initialize: function (options) {
			this.listenTo(this.model, 'add', this.render);

			this.listenTo(this.model, 'change', this.render);
			this.listenTo(this.model, 'destroy', this.remove);
	    },
	    render: function () {
			this.$el.addClass('message').html(this.template(this.model.toJSON()));
			return this;
	    },

        openContact: function () {
            Parley.app.dialog('contacts', {single: this.model.get('from').toJSON()});
        },
	    openMessage: function () {
            Parley.readMessageView = new ReadMessageView({model:this.model});

            this.$el.after(Parley.readMessageView.render().el);
	    },
        toggleSelect: function () {
            this.model.toggleSelect();
        },
	});

    var ReadMessageView = Parley.BaseView.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#readMessageTemplate').html()),
	    events: {
            'click .reply':     'openCompose'
	    },
	    render: function () {
            var message_body = _.reduce(this.model.readMessage(), function (memo, val) {
                return memo + '<p>' + val.replace('\\n', '<br>') + '</p>';
            }, '');
            
			this.$el.addClass('message-body').html(this.template({body:message_body}));
			return this;
	    },

        openCompose: function () {
            Parley.app.dialog(
              'compose',
              _.extend(
                this.model.toJSON(),
                {'plainText':this.model.readMessage(false)}
              )
            );
        }
    });

	var User = Parley.Contact.extend({
	    defaults: function () {
			return { registered: false };
	    },
	    initialize: function () {
	    }
	});

    var HeaderView = Parley.BaseView.extend({
        el: $('header'),
	    template: Mustache.compile($('#headerTemplate').html()),

        events: {
            'click #composeAction': function (e) {
                console.log('Composing new message.');
                Parley.app.dialog('compose');
            },
            'click #replyAction': function (e) {
                var sel = Parley.inbox.findWhere({selected:true});
                console.log('Replying to: ', sel);

                Parley.app.dialog('compose', reply_to.toJSON());
            },
            'click #forwardAction': function (e) {
                var sel = Parley.inbox.findWhere({selected:true});
                console.log('Forwarding: ', sel);
            },
            'click #deleteAction': function (e) {
                var sel = Parley.inbox.where({selected:true});
                console.log('Deleting: ', sel);

                Parley.vent.trigger('message:delete', sel);
            },
            'click #maliceAction': function (e) {
                console.log('Malice detected in: ', Parley.inbox.where({selected:true}));
            }
        },

        render: function () {
            this.$el.html(this.template());

            return this;
        }
    });

    var DialogView = Parley.BaseView.extend({
        el: $('#dialogWrapper'),

        /**
        This will be handled through the fancy vent
        but for now, it's like this...
        **/
        events: {
            'keydown': 'clickSubmit'
        },

        initialize: function (options) {
            /*
            Now, there is certainly a better way to do this but here's how I do it.
            For values that need to be recalculated every render, add init()
            in an object below and do what you need, secure in the knowledge that it
            will be invoked immediately before rendering.
            */
            this.dialogs = new Backbone.Collection([
                {   slug: 'loading',
                    el: '#dialog_loading',
                    template: Mustache.compile($('#loadingDialogTemplate').html()),
                    opts: { width: 600, position: ['center', 80], dialogClass: 'no-close', draggable: false },
                    title: 'Loading'
                },
                {   slug: 'setup',
                    el: '#dialog_setup',
                    template: Mustache.compile($('#setupDialogTemplate').html()),
                    opts: { width: 600, position: ['center', 80], dialogClass: 'no-close', draggable: false },
                    title: 'Welcome to Parley',
                    loaded: function (view) {
                        view.$('#text_message')._t('welcome');
                    },
                    events: {
                        'click #emailVerify': function (e) { Parley.vent.trigger('setup:verify', e); },
                        'click #loginAction': function (e) { Parley.vent.trigger('setup:login', e); },
                        'click #registerAction': function (e) { Parley.vent.trigger('setup:register', e); },
                        'keydown': 'clickSubmit'
                    }
                },
                {   slug: 'settings',
                    el: '#dialog_settings',
                    template: Mustache.compile($('#settingsDialogTemplate').html()),
                    opts: { resizable: false, width: 550 },
                    title: 'Parley Settings',
                    init: function () {
                        _.extend(this, Parley.currentUser.toJSON());
                    }
                },
                {   slug: 'contacts',
                    el: '#dialog_contacts',
                    template: Mustache.compile($('#contactsDialogTemplate').html()),
                    opts: { minWidth: 600, maxWidth: 1000 },
                    title: 'Contacts',
                    init: function () {
                        this.contacts = Parley.contacts.toJSON();
                    },
                    loaded: function (view) {
                        view.$('#contactsList').replaceWith(Parley.app.contactsList);
                    },
                    events: {
                        'click #newContact': function (e) {},
                        'click #addContact': function (e) {}
                    }
                },
                {   slug: 'nokey',
                    el: '#dialog_nokey',
                    template: Mustache.compile($('#nokeyDialogTemplate').html()),
                    opts: {},
                    title: 'Public PGP keys not found.',
                    events: {
                        'click #inviteAction': function (e) {}
                    }
                },
                {   slug: 'compose',
                    el: '#dialog_compose',
                    template: Mustache.compile($('#composeDialogTemplate').html()),
                    opts: {},
                    title: 'Compose',
                    init: function () {
                        var data = this.get('data');
                        data.to = _.has(data, 'reply_to') ? data.reply_to.toJSON() : _.has(data, 'from') ? data.from.toJSON() : undefined;
                        
                        if (_.has(data, 'subject')) {
                            var prefix = /^(R|r)e:/g;
                            data.subject = prefix.test(data.subject) ? data.subject : 're: ' + data.subject;
                        }

                        this.set('data', data);
                    },
                    loaded: function (view) {
                        var items = Parley.contacts.map(function (ele,i) {
                            var email = ele.get('email');
                            var name = ele.get('name') || email;

                            return {name: name, value: email, uid: name + ' <' + email + '>'}
                        });

                        var data = this.get('data');
                        var to = data.to;
                        var preFill = {};

                        if (_.isObject(to))
                            preFill = _.findWhere(items, {value: data.to.email}) || {};

                        var opts = {
                            selectedItemProp: 'name',
                            searchObjProps: 'name,value',
                            preFill: [preFill]
                        };
                        view.$('#recipients input[type=text]').each(function (){
                            $(this).autoSuggest(items, _.extend({asHtmlID: this.name}, opts));
                        });
                    },
                    events: {
                        'click #sendAction': function (e) { Parley.vent.trigger('message:send', e); }
                    }
                }
            ]);
        },

        render: function (options, slug) {
            console.log('Rendering dialog box.'); 

            if (slug) {
                var cur = this.dialogs.findWhere({slug:slug});
            } else {
                var cur = this.cur;
            }
            var template = cur.get('template');

            var data = cur.get('data') || {};
            _.extend(data, options);
            cur.set('data', data);

            if (init = cur.get('init')) init.call(cur);

            var $el = cur.get('$dialog') || this.$('#dialog_' + cur.get('slug'));

            if ($el.length == 0) {
                var $el = $('<div>').attr('id','dialog_' + cur.get('slug')).html(template(data));
                $('body').append($el);
                //this.$el.append($el);
            } else {
                $el.html(template(data));
            }

            this.setElement($el);

            var events = cur.get('events') || {};
            if (_.has(options, 'events')) {
                var events = _.extend(events, options.events);
            }
            this.delegateEvents(events);

            var dialog = cur.get('$dialog') || $(cur.get('el'));
            dialog.dialog( _.extend({
                autoOpen: true,
                dialogClass: '',
                draggable: true,
                title: cur.get('title')
            }, cur.get('opts') ));
            cur.set('$dialog', dialog);

            if (loaded = cur.get('loaded')) loaded.call(cur,this);

            return this;
        },

        setDialog: function (i, options) {
            console.log('Setting dialog.');

            // Either grab an existing dialog with slug = i,
            // or make one from scratch (for a modal dialog)
            if (_.isString(i)) {
                var d = this.dialogs.findWhere({slug: i});
                if (!d) {
                    if (_.has(options, 'modal')) {
                        var newDialog = {
                            slug: i,
                            modal: true,
                            template: Mustache.compile($('#blankDialogTemplate').html()),
                            el: '#dialog_' + i,
                            data: options
                        };
                        this.dialogs.add(newDialog);
                        this.cur = this.dialogs.findWhere({slug:i});
                    } else {
                        // Error, no 'this.cur'
                        return false;
                    }
                } else {
                    this.cur = d;
                }
            } else if (_.isNumber(i)) {
                this.cur = this.dialogs.at(i);
            } else {
                return false;
            }

            return true;
        },

        setPage: function (i, options) {
            console.log('Setting page.');

            //var cur = _.extend(this.cur, options);
            var cur = this.cur;

            var cur_page, pages = $(cur.get('el')).find('.page');
            if (_.isNumber(i) && (cur_page = pages.get(i) || pages.first())) {
                pages.removeClass('page-active');
                cur_page.addClass('page-active');
            } else if (_.isString(i)) {
                cur_page = pages.filter('.page-'+i, i).first();
                if (cur_page.length) {
                    pages.removeClass('page-active');
                    cur_page.addClass('page-active');
                }
            }
            if (pages.filter('.page-active').length == 0) {
                pages.first().addClass('page-active');
            }

            this.$(':input').first().focus();
        },

        show: function (slug) {
            if (this.cur = this.dialogs.findWhere({slug:slug}) || this.dialogs.at(0)) {
                $(this.cur.el).dialog();
            } else {
                return false;
            }
        },
        hide: function (slug) {
            var dialog = this.dialogs.findWhere({slug:slug});
            if (dialog) {
                $(dialog.get('el')).dialog('close');

                if (dialog.get('modal'))
                    dialog.destroy();
            } else {
                return false;
            }
        },

        clickSubmit: function (e) {
            switch (e.keyCode) {
                case 13:
                    this.$('input[type=submit],button:visible').click();
                case 27:
                    e.preventDefault();
                    break;
            }
        }
    });

	var AppView = Parley.BaseView.extend({
	    el: $('body'),

	    events: {
			'click #settingsAction':	'openSettings',
			'click #contactsAction':	'openContacts',
            'click .hidden':            'showHidden'
	    },

        vent: _.extend({}, Backbone.Events),

	    initialize: function () {
			console.log('Initializing Parley.');
            this.i18n = new Parley.i18n;

            this.header = new HeaderView;
            this._dialog = new DialogView;

			this.inbox = $('#inbox tbody');
			this.contactsList = $('<div>');

			this.listenTo(Parley.inbox, 'add', this.addMessage);
			this.listenTo(Parley.contacts, 'add', this.addContact);
            this.listenTo(Parley.inbox, 'change:selected', this.messageSelectedHandler);

            (function (user,app) {
                if (!user) {
		    	    console.log('No user logged in. Showing setup dialog.');
                    app.dialog('setup', { message: app.i18n._t('welcome') });
			    } else {
                    console.log('User logged in: ' + user);
                    Parley.currentUser = new Parley.Contact(JSON.parse(user));
                    app.dialog('setup login', _.extend({}, Parley.currentUser.toJSON(), { message: app.i18n._t('login') }));
                }
            })(false /* localStorage.getItem('currentUser') */,this);

			this.render();
	    },

	    render: function () {
            console.log('Rendering the app');
           
            this.assign(this.header, 'header');
            return this;
		},

        openSettings: function () {
            this.dialog('settings');
        },
        openContacts: function () {
            this.dialog('contacts');
        },
	    showHidden: function (e) {
            console.log(e.target);
            $(e.target).removeClass('hidden');
        },
        /**
        This function controls the dialog boxes.
        The syntax is like:

            Parley.app.dialog("(show|hide) [dialog slug] [page name]", data);
            
        If you omit the first word, it assumes 'show'
            Parley.app.dialog("[dialog slug]", data);

        If you pass it 'info' for the dialog slug, it will create a brand new
        separate dialog with [page name] as the slug. Use this for "loading" windows
        or modal dialogs.
        Make sure you pass a button:
            button: [{id:'buttonId',text:'click me'}, etc.]
        and an event:
            event: [{"click #buttonId":function(e){ Parley.vent.trigger('button:clicked'); }}, etc.]
        as members of 'data'.
        **/
        dialog: function (opts,data) {
            if (_.isString(opts)) {
                var _a = opts.split(' ');
                switch (_a[0]) {
                    case 'hide':
                        var slug = _a[1],
                            page = _a[2];
                        if (slug == 'info') slug = page;

                        this._dialog.hide(slug);
                        break;
                    case 'show':
                        var slug = _a[1],
                            page = _a[2];
                    default:
                        var slug = slug || _a[0],
                            page = page || _a[1];
                        if (slug == 'info') {
                            if ( this._dialog.setDialog( page, {modal:true} ) ) 
                                this._dialog.render( data, page );
                        } else {
                            if (this.curDialog == slug) {
                                this._dialog.render( data, slug );
                                this._dialog.setPage(page,data);
                            } else if (this._dialog.setDialog(slug, data)) {
                                this.curDialog = slug;
                                this._dialog.render( data, slug )
                                this._dialog.setPage(page,data);
                            }
                        }
                        break;
                }
            }
        },

		addContact: function (contact) {
			var view = new ContactView({model: contact});
			this.contactsList.append(view.render().el);
		},

	    addMessage: function (message) {
			var view = new MessageView({model: message});
			this.inbox.append(view.render().el);
	    },

	    loadUser: function () {
			console.log('Setting up main view with logged in user info');

            //localStorage.setItem('currentUser', JSON.stringify(Parley.currentUser));

            Parley.vent.trigger('contact:sync');
            Parley.vent.trigger('message:sync');

			this.$el.addClass('loggedin').removeClass('loggedout');
			this.header.$('.email').text(Parley.currentUser.get('email'));
	    },

        messageSelectedHandler: function () {
            var selectedMessages = Parley.inbox.where({selected:true});
            if (selectedMessages.length == 0) {
            } if (selectedMessages.length == 1) {
                this.header.$('#inbox-utilities').removeClass('multi-sel no-sel').addClass('has-sel');
            } else if (selectedMessages.length > 1) {
                this.header.$('#inbox-utilities').removeClass('no-sel has-sel').addClass('multi-sel');
            } else {
                this.header.$('#inbox-utilities').removeClass('multi-sel has-sel').addClass('no-sel');
            }
        }
	});
	
    Parley.inbox = new MessageList;
    Parley.contacts = new ContactList;
	Parley.app = new AppView;

	$('button').button();
}(window.Parley = window.Parley || {}, jQuery));
