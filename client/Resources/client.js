(function(Parley, $, undefined){
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
				count: 0
			}
	    },
        parse: function (data, options) {
            if (_.isObject(data)) {
                if (_.has(data,'uids')) {
                    console.log('Creating contact from OBJECT WITH UIDS', data.uids);
                    var parsed = Parley.parseUID(data.uids[0]);
                    return _.extend(data,{name:parsed.name,email:parsed.email})
                } else if (_.has(data,'email')) {
                    console.log('Begin creating contact from: \'' + data.email + '\'');
                    var fingerprint = Parley.requestPublicKey(data.email);
                    var userinfo = Parley.AFIS(fingerprint);
                    if (userinfo.length > 0) {
                        userinfo = _.isArray(userinfo) ? userinfo[0] : userinfo;

                        var parsed = Parley.parseUID(userinfo.uids[0]);
                        return _.extend(data, userinfo, {name:parsed.name,email:parsed.email})
                    } else {
                        return _.extend(data, {email:data.email});
                    }
                } else {
                    console.log('Creating contact from OBJECT WITHOUT UIDS', data);
                    return data;
                }
            } else {
                console.log('Creating blank contact.');
                return data;
            }
        }
	});

	var ContactList = Backbone.Collection.extend({
	    model: Parley.Contact
	});
	var ContactView = Parley.BaseView.extend({
	    tagName: 'tr',
	    template: Mustache.compile($('#contactTemplate').html()),
	    events: {},
	    initialize: function () {
	    },
		render: function () {
			var data = this.model.toJSON();
			
			this.$el.addClass('contact').html(this.template(data));
			return this;
	    },
	});

	Parley.Message = Backbone.Model.extend({
        defaults: function () {
            return {
                from: {},
                subject: '',
                selected: false
            };
        },
        parse: function (data, options) {
            var from_obj = Parley.contacts.findWhere({email:data.addresses.from.email});
            
            if (!from_obj) {
                console.log('Creating contact from scratch.');
                var from_email = data.addresses.from.email;
                from_obj = new Parley.Contact({
                    email: from_email,
                    thumbnail: data.person_info[from_email].thumbnail
                }, {parse: true});
            }

            if (data.body[0].type == 'text/plain' && !~data.body[0].content.indexOf('-BEGIN PGP MESSAGE-'))
                this.unencryptedMessage = data.body[0].content;

            return _.extend(data, {from: from_obj, content: data.body[0].content});
        },
        readMessage: function () {
            if (this.unencryptedMessage) {
                console.log('Reading message from memory.');
                return this.unencryptedMessage;
            } else {
                console.log('Decrypting message.');
                var sender = this.getSender();
                this.unencryptedMessage = Parley.decryptAndVerify(this.get('content'), this.getSender());
                return this.unencryptedMessage;
            }
        },
        getSender: function () {
            return this.attributes.from;
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
            'click .from':          'openCompose',
			'click .subject':		'openMessage',
            'click .selector':      'toggleSelect'
	    },
	    initialize: function (options) {
            this.vent = options.vent;

			this.listenTo(this.model, 'add', this.render);

			this.listenTo(this.model, 'change', this.render);
			this.listenTo(this.model, 'destroy', this.remove);
	    },
	    render: function () {
			var data = this.model.toJSON();
            data = _.extend(data, data.from.toJSON());

			this.$el.addClass('message').html(this.template(data));
			return this;
	    },

        openContact: function () {
            Parley.app.dialog('contacts', {single: this.model.get('from').toJSON()});
        },
	    openMessage: function () {
            Parley.readMessageView = !!Parley.readMessageView ? (Parley.readMessageView.model.set(this.model.toJSON()) && Parley.readMessageView) :
                new ReadMessageView({model:this.model,vent:this.vent});

            this.$el.after(Parley.readMessageView.render().$el.detach());
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
			this.$el.addClass('message-body').html(this.template(this.model.toJSON()));
			return this;
	    },

        openCompose: function () {
            Parley.app.dialog('compose', this.model.toJSON());
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
            'click #composeAction':     'compose',
            'click #replyAction':       'reply',
            'click #forwardAction':     'forward',
            'click #deleteAction':      'delete',
            'click #maliceAction':      'malice'
        },

        render: function () {
            this.$el.html(this.template());

            return this;
        },

        compose: function (e) {
            console.log('Composing new message.');
            Parley.app.dialog('compose');
        },
        reply: function (e) {
            console.log('Replying to: ', Parley.inbox.findWhere({selected:true}));

            var reply_to = Parley.inbox.findWhere({selected:true});
            Parley.app.dialog('compose', reply_to.toJSON());
        },
        forward: function (e) {
            console.log('Forwarding: ', Parley.inbox.where({selected:true}));
        },
        "delete": function (e) {
            console.log('Deleting: ', Parley.inbox.where({selected:true}));
        },
        malice: function (e) {
            console.log('Malice detected in: ', Parley.inbox.where({selected:true}));
        }
    });

    var DialogView = Parley.BaseView.extend({
        el: $('#dialogWrapper'),

        events: {
			'click #emailVerify':		'emailVerify',
            'click #loginAction':       'login',
            'click #registerAction':    'register',
			'click #logoutAction':		'logout',
            'change input':             'update',
            'click #sendAction':        'sendAction',
            'click #inviteAction':      'inviteAction'
        },

        initialize: function (options) {
            this.$el.dialog({autoOpen:false});

            /*
            Now, there is certainly a better way to do this but here's how I do it.
            For values that need to be recalculated every render, add init()
            in an object below and do what you need, secure in the knowledge that it
            will be invoked immediately before rendering.
            */
            this.dialogs = new Backbone.Collection([
                {   slug: 'loading',
                    template: Mustache.compile($('#loadingDialogTemplate').html()),
                    opts: { width: 600, position: ['center', 80], dialogClass: 'no-close', draggable: false },
                    title: 'Loading'
                },
                {   slug: 'setup',
                    template: Mustache.compile($('#setupDialogTemplate').html()),
                    opts: { width: 600, position: ['center', 80], dialogClass: 'no-close', draggable: false },
                    title: 'Welcome to Parley'
                },
                {   slug: 'settings',
                    template: Mustache.compile($('#settingsDialogTemplate').html()),
                    opts: { resizable: false, width: 550 },
                    title: 'Parley Settings',
                    init: function () {
                        _.extend(this, Parley.currentUser.toJSON());
                    }
                },
                {   slug: 'contacts',
                    template: Mustache.compile($('#contactsDialogTemplate').html()),
                    opts: { minWidth: 600, maxWidth: 1000 },
                    title: 'Contacts',
                    init: function () {
                        this.contacts = Parley.contacts.toJSON();
                    }
                },
                {   slug: 'nokey',
                    template: Mustache.compile($('#nokeyDialogTemplate').html()),
                    opts: {},
                    title: 'Public PGP keys not found.'
                },
                {   slug: 'compose',
                    template: Mustache.compile($('#composeDialogTemplate').html()),
                    opts: {},
                    title: 'Compose',
                    init: function () {
                        this.to = this.from.toJSON();

                        var prefix = /^(R|r)e:/g;
                        this.subject = prefix.test(this.subject) ? this.subject : 're: ' + this.subject; 
                    },
                    loaded: function (view) {
                        var items = Parley.contacts.map(function (ele,i) {
                            var email = ele.get('email');
                            var name = ele.get('name') || email;

                            return {name: name, value: email, uid: name + ' <' + email + '>'}
                        });
                        var opts = {
                            selectedItemProp: 'name',
                            searchObjProps: 'name,value'
                        };
                        view.$('#recipients input[type=text]').each(function (){
                            $(this).autoSuggest(items, _.extend({asHtmlID: this.name}, opts));
                        });
                    }
                }
            ]);
        },

        render: function () {
            console.log('Rendering dialog box');
            var args = _.isObject(arguments[0]) ? arguments[0] : {};
            var isOpen = this.$el.dialog('isOpen');
            if (isOpen && !this.cur) {
                this.$el.dialog('close');
            } else if (_.isObject(this.cur)) {
                var template = this.cur.get('template');
                var data = this.cur.toJSON();

                data = _.extend(args, data);
                if (_.has(data, 'init'))
                    data.init(this);

                this.$el.dialog(_.extend({
                        autoOpen: true,
                        dialogClass: '',
                        draggable: true,
                        title: this.cur.get('title')
                    }, data.opts));
                this.$el.html(template(data));

                if (_.has(data, 'loaded'))
                    data.loaded(this);
            }
            return this;
        },

        setDialog: function (i, options) {
            if (_.isNumber(i) && (this.cur = this.dialogs.at(i) || undefined)) {
                this.render(options);
                this.setPage();
                return true;
            } else if (_.isString(i) && ( this.cur = this.dialogs.findWhere({slug:i}) || undefined )) {
                this.render(options);
                this.setPage();
                return true;
            } else {
                return false;
            }
        },

        setPage: function (i, options) {
            var cur_page, pages = this.$('.page');
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
            if (_.isObject(options)) {
                for (var val in options) {
                    cur_page.find('[name='+val+']').val(options[val]);
                }
            }
            this.$(':input').first().focus();
        },

        show: function () {
            this.cur = this.cur || this.dialogs.at(0);
            this.render();
        },
        hide: function () {
            this.cur = undefined;
            this.render();
        },

	    emailVerify: function (e) {
            e.preventDefault();
			var form = document.forms.emailVerify;
            if (_.isUndefined(form.email.value)) return false;
            console.log('Verifying email address: ' + form.email.value);

			Parley.requestUser(form.email.value, _.bind(function (data, textStatus) {
                //console.log(JSON.stringify(data), textStatus, data.error);
		    	if (_.isObject(data) && !_.has(data, 'error')) {
                    console.log('User exists, setting up login form.');
                    this.setPage('login', {email: form.email.value});
		    	} else {
                    console.log('User doesn\'t exists, showing registration form.');
                    this.setPage('register', {email: form.email.value});
		    	}
		    }, this));
	    },
        register: function (e) {
            e.preventDefault();
            var form = document.forms.registerAction;
            if (form.password_one.value != form.password_two.value) {
                // Passwords don't match
                console.log('Passwords don\'t match.');
            } else {
                this.setDialog('loading', { message: 'It takes a while to register! Like, quite a while. This will be fixed, but for now you must wait. And wait you must. Minutes. Sometimes 5. 2 if you\'re lucky. 10 if not. But really. Give it some time, it will be totally worth it. I promise.' });
                Parley.registerUser(form.name.value, form.email.value, form.password_two.value, _.bind(function (data, textStatus) {
                    console.log(JSON.stringify(data), textStatus, data.error);

                    console.log('New user successfully registered with email: ' + Parley.currentUser.get('email'));
                    console.log('Registering new inbox with Context.io');
                    
                    Parley.registerInbox();

                    Parley.app.loadUser();
                    this.hide();
                }, this));
            }
        },
        login: function (e) {
            e.preventDefault();
            var form = document.forms.loginAction;

            this.setDialog('loading', { message: 'It takes a while to log in! We know that\'s totally "shitty" or, "the worst" but we are working on it. It might be 2 or 3 minutes. That\'s not so bad, right? Anyway, to pass the time, I will sing you a song: do do d\'do do DOO DOO. Have fun!' });
            Parley.authenticateUser(form.email.value, form.password.value, _.bind( function (data, textStatus) {
                console.log('User successfully logged in.');
                Parley.app.loadUser();
                this.hide();
            }, this));
        },    
	    logout: function () {
			console.log('Logging out');
			Parley.currentUser.destroy();
            Parley.app.render();
	    },
        sendAction: function (e) {
            e.preventDefault();

            var formdata = this.$('form').serializeObject();

            var recipients = [], nokeyRecipients = [];
            var recFields = ['as_values_to', 'as_values_cc', 'as_values_bcc'];
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
            
            if (nokeyRecipients.length > 0) {
                console.log('We have no keys for these recipients: ', nokeyRecipients);
                Parley.app.dialog('nokey', {emails:nokeyRecipients});
            } else { }

            if (!_.isEmpty(recipients)) Parley.encryptAndSend(formdata.subject, formdata.body, recipients);
        },
        inviteAction: function (e) {
            var email,selected = this.$('.selector a.clicked').parent();
            selected.each(function (i,e) {
                var $e = $(e);
                email = $e.find('.email').text();
                Parley.invite(email, function () {});
            });
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

            this.header = new HeaderView({vent:this.vent});
            this._dialog = new DialogView({vent:this.vent});

			this.inbox = $('#inbox tbody');
			this.contactsList = $('#contactsList');

			this.listenTo(Parley.inbox, 'add', this.addMessage);
			this.listenTo(Parley.contacts, 'add', this.addContact);
            this.listenTo(Parley.inbox, 'change:selected', this.messageSelectedHandler);

			if (!Parley.currentUser) {
		    	console.log('No user logged in. Showing setup dialog.');
                this.dialog('setup');
			}

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
        dialog: function () {
            if (typeof arguments[0] == 'undefined') {
                // With no arguments, returns dialog data as object
                return this._dialog.getJSON();
            } else if (_.isObject(arguments[0])) {
                // Currently does nothing (always pass a string as first arg)
                // Will eventually support passing an object, I'll get to it in a sec
            } else if (_.isString(arguments[0])) {
                var actions = arguments[0].split(' ');
                switch (actions[0]) {
                    case 'hide':
                        this._dialog.hide();
                        break;
                    default:
                        if (this._dialog.setDialog(actions[0], arguments[1])) {
                            this._dialog.setPage(actions[1]);
                        }
                        break;
                }
            }
        },

		addContact: function (contact) {
			var view = new ContactView({model: contact, vent:this.vent});
			this.contactsList.append(view.render().el);
		},

	    addMessage: function (message) {
			var view = new MessageView({model: message, vent:this.vent});
			this.inbox.append(view.render().el);
	    },

	    loadUser: function () {
			console.log('Setting up main view with logged in user info');
            var opts = {parse:true};
            Parley.requestInbox(function (data, textStatus) {
                console.log('Inbox loaded', JSON.stringify(data.messages));
                if (_.has(data, 'messages'))
                    Parley.inbox = Parley.inbox || new MessageList({}, opts);
                    for (var i = 0, t = data.messages.length; i<t; i++) {
                        Parley.inbox.add(data.messages[i], opts);
                    }
                    //Parley.inbox = (Parley.inbox && Parley.inbox.set(data.messages, opts)) || new MessageList(data.messages, opts);
            });
            console.log('Populating contacts from keychain');
            Parley.contacts.set(Parley.listKeys(),{parse:true});
 
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
