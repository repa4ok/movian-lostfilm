(function(plugin) {
    var PREFIX = plugin.getDescriptor().id;
    var TITLE = plugin.getDescriptor().title;
    var SYNOPSIS = plugin.getDescriptor().synopsis;
    var BASE_URL = "http://delta.lostfilm.tv";
    var LOGO = Plugin.path + "logo.png";

    var service = require("showtime/service");
    var http = require("showtime/http");
    var html = require("showtime/html");

    service.create(TITLE, PREFIX + ":start", "video", true, LOGO);

    var store = plugin.createStore("config", true);

    plugin.addURI(PREFIX + ":start", start);
    plugin.addURI(PREFIX + ":serialInfo:(.*):(.*):(.*)", serialInfo);

    plugin.addURI(PREFIX + ":torrent:(.*):(.*):(.*):(.*)", function (page, serieName, c, s, e) {
        var response = showtime.httpReq("http://delta.lostfilm.tv/v_search.php?c=" + c + "&s=" + s + "&e=" + e);
        var torrentsUrl = html.parse(response.toString()).root.getElementByTagName("meta")[0].attributes.getNamedItem("content")["value"].replace("0; url=", "");
        response = showtime.httpReq(torrentsUrl);

        var foundTorrents = {
            "sd": undefined,
            "hd": undefined,
            "fhd": undefined
        };

        var torrentArr = html.parse(response.toString()).root.getElementByClassName("inner-box--item");
        for (var i = 0; i < torrentArr.length; ++i) {
            var currentTorrent = torrentArr[i];
            var currentTorrentLabel = currentTorrent.getElementByClassName("inner-box--label")[0].textContent.trim().toLowerCase();
            var currentTorrentLink = currentTorrent.getElementByClassName("inner-box--link main")[0].children[0].attributes.getNamedItem("href").value;
            showtime.print("found torrent " + currentTorrentLabel + ". url = " + currentTorrentLink);

            if (currentTorrentLabel == "sd") {
                foundTorrents["sd"] = currentTorrentLink;
            } else if (currentTorrentLabel == "mp4" || currentTorrentLabel == "hd" || currentTorrentLabel == "720") {
                foundTorrents["hd"] = currentTorrentLink;
            } else if (currentTorrentLabel == "fullhd" || currentTorrentLabel == "full hd" || currentTorrentLabel == "1080") {
                foundTorrents["fhd"] = currentTorrentLink;
            }
        }

        var desiredUrl = foundTorrents[store.quality];

        if (desiredUrl == undefined) {
            if (foundTorrents["sd"]) {
                desiredUrl = foundTorrents["sd"];
                showtime.print(store.quality + " torrent not found. Playing SD instead...");
            } else if (foundTorrents["hd"]) {
                desiredUrl = foundTorrents["hd"];
                showtime.print(store.quality + " torrent not found. Playing HD instead....");
            } else if (foundTorrents["fhd"]) {
                desiredUrl = foundTorrents["fhd"];
                showtime.print(store.quality + " torrent not found. Playing Full HD instead....");
            }
        } else {
            showtime.print(store.quality + " torrent found. Playing it...");
        }

        if (desiredUrl == undefined || desiredUrl == "") {
            page.error("Failed to find desired torrent.");
            return;
        }

        var x = http.request(desiredUrl);
        page.loading = false;

        page.source = "videoparams:" + showtime.JSONEncode({
            title: serieName,
            canonicalUrl: PREFIX + ":torrent:" + serieName + ":" + c + ":" + s + ":" + e,
            sources: [{
                url: 'torrent:video:' + desiredUrl
            }]
        });
        page.type = "video";
    });

    function start(page) {
        page.metadata.logo = LOGO;
        page.metadata.title = TITLE;

        page.model.contents = "list";
        page.loading = true;
        // need to move to separate function

        page.options.createMultiOpt('quality', 'Quality', [
            ['sd',  'SD', true],
            ['hd',       'HD'],
            ['fhd',      'Full HD']], 
            function(v) {
                store.quality = v;
            },
        true);

        if (store.quality == undefined || store.quality == "") {
            store.quality = "sd";
        }

        if (checkCookies()) {
            applyCookies();
            populateMainPage(page);
        } else if (performLogin(page)) {
            applyCookies();
            populateMainPage(page);
        } else {
            page.error("Login failed.");
            return;
        }
        
        page.type = "directory";
        page.loading = false;
    }

    function checkCookies() {
        //var response = showtime.httpReq("http://delta.lostfilm.tv");
        // showtime.print("CHECK COOCKIES: ");
        // showtime.print(store.userCookie);
        // if (response.multiheaders["Set-Cookie"]) {
            // saveUserCookie(response.multiheaders);
            // return true;
        // } else {
            // return false;
        // }
        return store.userCookie && store.userCookie != "DONT_TOUCH_THIS";
    }

    function applyCookies() {
        plugin.addHTTPAuth("http://.*\\.lostfilm\\.tv", function(req) {
            req.setHeader("Cookie", store.userCookie);
            req.setHeader('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0');
        });
    }

    function populateMainPage(page) {
        page.appendItem("", "separator", {
            title: "Favorites"
        });

        var response = showtime.httpReq("http://delta.lostfilm.tv/series/?type=search&s=2&t=99");
        var serialsListDiv = html.parse(response.toString()).root.getElementById("serials_list");
        var serialsList = serialsListDiv.getElementByClassName(["row"]);
        for (var i = 0; i < serialsList.length; ++i) {
            var currentSerialBody = serialsList[i].getElementByClassName(["body"])[0];
            var currentSerialName = currentSerialBody.getElementByClassName(["name-ru"])[0].textContent;
            var currentSerialLink = serialsList[i].getElementByClassName(["no-decoration"])[0].attributes.getNamedItem("href").value;
            var currentSerialId = serialsList[i].children[2].attributes.getNamedItem("id").value.replace("fav_", "");
            page.appendItem(PREFIX + ":serialInfo:" + currentSerialName + ":" + currentSerialId + ":" + currentSerialLink, "directory", {
                title: currentSerialName
            });
        }

        page.appendItem("", "separator", {
            title: "Popular"
        });

        response = showtime.httpReq("http://delta.lostfilm.tv/series/?type=search&s=1&t=0");
        serialsListDiv = html.parse(response.toString()).root.getElementById("serials_list");
        serialsList = serialsListDiv.getElementByClassName(["row"]);
        for (var i = 0; i < serialsList.length; ++i) {
            var currentSerialBody = serialsList[i].getElementByClassName(["body"])[0];
            var currentSerialName = currentSerialBody.getElementByClassName(["name-ru"])[0].textContent;
            var currentSerialLink = serialsList[i].getElementByClassName(["no-decoration"])[0].attributes.getNamedItem("href")["value"];
            page.appendItem(PREFIX + ":serialInfo:" + currentSerialName + ":-1:" + currentSerialLink, "directory", {
                title: currentSerialName
            });
        }

        page.appendItem("", "directory", {
            // FIXME: icon is not applied
            //icon: "watched.svg",
            title: "More..."
        });
    }


var iso8601DurationRegex = /(-)?P(?:([\.,\d]+)Y)?(?:([\.,\d]+)M)?(?:([\.,\d]+)W)?(?:([\.,\d]+)D)?T(?:([\.,\d]+)H)?(?:([\.,\d]+)M)?(?:([\.,\d]+)S)?/;

function parseISO8601Duration(s) {
  var m = s.match(iso8601DurationRegex);

  return (m[8] === undefined ? 0 : m[8]) * 1 +
    (m[7] === undefined ? 0 : m[7]) * 60 +
    (m[6] === undefined ? 0 : m[6]) * 3600 +
    (m[5] === undefined ? 0 : m[5]) * 86400;
};

    function serialInfo(page, serialName, serialID, url) {
        page.metadata.logo = LOGO;
        page.metadata.title = serialName;
        // page.model.contents = "list";
        page.type = "directory";
        page.metadata.glwview = plugin.path + "views/serial.view";
        page.loading = true;
/*
        // get watched series
        var response = showtime.httpReq("http://delta.lostfilm.tv/ajaxik.php", {
            debug: true,
            postdata: {
                'act': "serial",
                'type': "getmark",
                'id': serialID
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': url,
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': 'http://delta.lostfilm.tv'
            }
        });

        showtime.print("LOSTFILM WATCHED");
        showtime.print(showtime.JSONDecode(response));
*/
        var response = showtime.httpReq("http://delta.lostfilm.tv/" + url + "/seasons/");
        var seasonsList = html.parse(response.toString()).root.getElementByClassName("serie-block");
        for (var i = 0; i < seasonsList.length; ++i) {
            var seasonName = seasonsList[i].getElementByTagName("h2")[0].textContent;
            showtime.print("LOSTFILM: season name: " + seasonName);
            page.appendItem("", "separator", {
                title: seasonName
            })
            var seasonSeries = seasonsList[i].getElementByTagName("tr");
            for (var j = 0; j < seasonSeries.length; ++j) {
                if (seasonSeries[j].attributes.length > 0) {
                    continue;
                }
                var watched = seasonSeries[j].getElementByClassName(["alpha"])[0].children[0].attributes.getNamedItem("class").value;
                var serieDiv = seasonSeries[j].getElementByClassName(["gamma"])[0].children[0];
                var serieDirtyName = serieDiv.textContent.trim();
                var serieNativeName = serieDiv.getElementByTagName("span")[0].textContent;
                var serieNumber = seasonSeries.length - j;
                var serieName = serieDirtyName.replace(serieNativeName, "") + " (" + serieNativeName + ")";

                showtime.print("LOSTFILM serie " + serieName + ": " + watched);

                var serieAttrs = seasonSeries[j].getElementByClassName(["zeta"])[0].children[0].attributes.getNamedItem("onclick")["value"].replace("PlayEpisode('", "").replace("')", "").split("','");
                page.appendItem(PREFIX + ":torrent:" + serieName + ":" + serieAttrs[0] + ":" + serieAttrs[1] + ":" + serieAttrs[2], "video", {
                    title: new showtime.RichText("<font color='#b3b3b3'>[" + (serieNumber < 10 ? "0" : "") + serieNumber + "]</font>    " + serieName),
                    watched: false
                });
            }
        }

        page.loading = false;
    }

    function performLogin(page) {
        var credentials = plugin.getAuthCredentials(plugin.getDescriptor().synopsis, "Login required", true);
        var response, result;
        if (credentials.rejected) return false; //rejected by user
        if (credentials) {
            response = showtime.httpReq("http://login1.bogi.ru/login.php?referer=https://www.lostfilm.tv", {
                postdata: {
                    'login': credentials.username,
                    'password': credentials.password,
                    'module': 1,
                    'target': 'http://lostfilm.tv',
                    'repage': 'user',
                    'act': 'login'
                },
                noFollow: true,
                headers: {
                    'Upgrade-Insecure-Requests': 1,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0',
                    'Referer': 'http://www.lostfilm.tv',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': ''
                }
            });

            showtime.print("LOSTFILM login (phase 1) response:");
            showtime.print(response.toString());

            var bogiDom = html.parse(response.toString());
            var formAction = bogiDom.root.getElementById("b_form").attributes.getNamedItem("action");
            showtime.print("LOSTFILM login action url: " + formAction["value"]);

            var inputs = bogiDom.root.getElementById("b_form").getElementByTagName("input");
            var outputs = {};
            for (var i = 0; i < inputs.length; ++i) {
                // showtime.print("LOSTFILM login input: " + ));
                var inputName = inputs[i].attributes.getNamedItem("name");
                var inputValue = inputs[i].attributes.getNamedItem("value");
                if (inputName && inputValue) {
                    var resultName = inputName["value"];
                    var resultValue = inputValue["value"];
                    // showtime.print("LOSTFILM login input value " + i + ": [" + resultName + ":" + resultValue + "]");
                    outputs[resultName] = resultValue;
                }
            }
            // showtime.print("LOSTFILM postdata: " + JSON.stringify(outputs));

            response = showtime.httpReq(formAction["value"], {
                postdata: outputs,
                noFollow: true,
                headers: {
                    'Upgrade-Insecure-Requests': 1,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:50.0) Gecko/20100101 Firefox/50.0',
                    'Referer': 'http://www.lostfilm.tv',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': ''
                }
            });

            saveUserCookie(response.multiheaders);
            return true;
        } else {
            return false;
        }
    }

    function saveUserCookie(headers) {
        var cookie;
        if (!headers) return false;
        cookie = headers["Set-Cookie"];
        showtime.print("LOSTFILM cookies...");
        if (cookie) {
            cookie.join("");
            showtime.print(cookie);
            store.userCookie = cookie;
        }
    }
})(this);
