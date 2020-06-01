'use strict';

var ObjectID = require('mongodb').ObjectID;
var request = require('request');
const fs = require('fs');
const path = require('path');
//const jsdom = require('jsdom');
const cheerio = require('cheerio');

function bugHandler (dbParent) {

    // "db.collection is not a function"
    var db = dbParent.db("clementine");
    var bugs = db.collection('bugs');
    var validations = db.collection('validations');
    var tenants = db.collection('tenants');
    var bugComments = db.collection('bugComments');

  // db used to return the db, now it returns the parent in mongo 3.0.0.
  // So, need to point it to the real db each time.

    const TEAMS_ADO_API_BASE = "https://dev.azure.com/domoreexp/MSTeams/_apis/wit/";
    const TEAMS_ADO_BUGS_ENDPOINT = TEAMS_ADO_API_BASE + "workitems/$bug?api-version=4.1";
    const TEAMS_ADO_WORKITEM_UPDATE_ENDPOINT = TEAMS_ADO_API_BASE + "workitems/{id}?api-version=4.1";
    const TEAMS_ADO_WORKITEM_COMMENTS_ENDPOINT = TEAMS_ADO_API_BASE + "workitems/{id}/comments?order=asc";

    // New way of naming things
    const TEAMS_ADO_ATTACHMENT_CREATE_ENDPOINT = TEAMS_ADO_API_BASE + "attachments";

    const QUERY_BY_WIQL_ENDPOINT = "https://dev.azure.com/domoreexp/MSTeams/_apis/wit/wiql?api-version=5.0";

    // This one's for production
    var AUTH = process.env.AUTH;

    function fixHtml(html) {
        const domObj = cheerio.load(html, { xmlMode: true });
        return domObj.html();
    }


    function cleanComment(comment) {
        comment = comment.replace("@TAP-Fenix", "");
        comment = comment.split("Attachment 1")[0];

        //comment = comment.replace(/<br>/g, "");
        comment = comment.replace(/&nbsp;/g, "");

        //comment = comment.replace(/<style[^>]*>.*<\/style>/gm, '')
        //    // Remove script tags and content
        //    .replace(/<script[^>]*>.*<\/script>/gm, '')
        //    // Remove all opening, closing and orphan HTML tags
        //    .replace(/<[^>]+>/gm, '')
        //    // Remove leading spaces and repeated CR/LF
        //    .replace(/([\r\n]+ +)+/gm, '');


        comment = fixHtml(comment);
        comment = comment.replace(/^\s*(?:<br\s*\/?\s*>)+|(?:<br\s*\/?\s*>)+\s*$/g, "");
        comment = comment.replace(/<\/br>/g, "");
        //console.log(comment);

        return comment;
    }
      this.getBug = function(req, res) {
        console.log("Calling getBug");
        console.log(req.params.vId);
        var bugProjection = {}
        var query = ObjectID(req.params.vId);
        //console.log(query);
        bugs.findOne(query, bugProjection, function(err, doc) {
          if (err) {
            throw err;
          }

          //res.json(doc);
          //console.log(doc);
          res.render('bug', {
            name: doc.name,
            upvotes: doc.upvotes,
            downvotes: doc.downvotes
          });
        });
      };

      this.getOneBug = function(req, res) {
        var refUrlParts = req.url.split('/');
        const bId = parseInt(refUrlParts.pop());

          // bug IDs are just ints, not OIDs
          var query = { "_id": bId };
        bugs.findOne(query, {}, function(err, doc) {
          if (err) { throw err; }

          res.json(doc);
          console.log(doc);
        })
      }

      this.addBug = function(req, res) {
        console.log("addbug got called");
        //console.log(req.body);
        //console.log(req.headers.referer.split('/'))

        //console.log(req);

        //var refUrlParts = req.headers.referer.split('/')
        //var validationId = refUrlParts.pop();
        var validationId = req.body.validationId;
          var bugSubmitter = req.body.submitter;
          var submitterTenantId = req.body.submitterTenantId;

          console.log("bugSubmitter is " + bugSubmitter);

          console.log("Creating new bug with validaitonId " + validationId);

        validations.findOne(ObjectID(validationId), {}, function(err, valDoc) {
          if (err) { throw err; }

          var newBug = {
            name: req.body.bugDescription,
            validationId: ObjectID(validationId),
            validationTag: valDoc.tag,
            submitter: bugSubmitter,
            submitterTenantId: submitterTenantId,
            vstsState: "New",
            clientType: req.body.clientType,
            upvotes: [bugSubmitter,],
            downvotes: [],
              timestamp: new Date(),
            };

            var validationName = valDoc["name"];

      
            if (req.body.hasOwnProperty("vstsId")) {
                console.log("vstsId was detected in the request");
                newBug._id = req.body.vstsId;
            } else {
                console.log("No vstsId in that request");
            }

            if (req.body.hasOwnProperty("vstsState")) {
                newBug.vstsState = req.body.vststState;
            }

            // Set the timestamp if it's there. Useful for importing older bugs
            if (req.body.hasOwnProperty("timestamp")) {
                newBug.timestamp = req.body.timestamp;
            }

            // TODO: Code smellz
            if (newBug.hasOwnProperty("_id")) {
                bugs.insertOne(newBug, function (err, doc) {
                    console.log("Calling insertOne");
                    if (err) {
                        if (err.name === 'MongoError' && err.code === 11000) {
                            return res.status(500).send({ success: false, message: 'Bug is already in the DB' });
                        }
                        throw err;
                    }

                    console.log("New bug created:" + JSON.stringify(doc.ops[0]));

                    res.json(doc.ops[0]);
                });
            } else {
                var bugProjection = {};

                console.log("No vstsId, so adding this to vsts");

                // Add the new bug to VSTS
                var reqBody = [
                    {
                        "op": "add",
                        "path": "/fields/System.Title",
                        "value": newBug.name
                    },
                    {
                        "op": "add",
                        "path": "/fields/System.AreaPath",
                        "value": "MSTeams\\Customer Feedback"
                    },
                    {
                        "op": "add",
                        "path": "/fields/Microsoft.VSTS.TCM.SystemInfo",
                        "value": "Submitted by " + bugSubmitter + " through the TAP Validation Tab for '" + validationName + "'"
                    },
                    {
                        "op": "add",
                        "path": "/fields/MicrosoftTeamsCMMI.CustomerName",
                        "value": submitterTenantId
                    },
                    {
                        "op": "add",
                        "path": "/fields/MicrosoftTeamsCMMI.CustomerEmail",
                        "value": bugSubmitter
                    },
                    // TODO: Add other ops here
                ];
                const options = {
                    url: TEAMS_ADO_BUGS_ENDPOINT,
                    headers: {
                        'Authorization': AUTH,
                        'Content-Type': 'application/json-patch+json'
                    },
                    body: JSON.stringify(reqBody)
                };

                request.post(options, function (vstsErr, vstsStatus, vstsResponse) {
                    if (vstsErr) { throw vstsErr; }
                    var vstsJson = JSON.parse(vstsResponse);
                    console.log(vstsStatus);
                    console.log(vstsResponse);
                    console.log(vstsJson);
                    const vstsId = parseInt(vstsJson.id);
                    console.log("the vstsID is", vstsId);
                    newBug._id = vstsId;
                    // TODO: What to do if something is submitted with the same VSTSID?
                    bugs.insertOne(newBug, function (err, doc) {
                        console.log("Calling insertOne");
                        if (err) {
                            throw err;
                        }

                        console.log("New bug created:" + JSON.stringify(doc.ops[0]));

                        res.json(doc.ops[0]);
                    });
                });
            }
          })
      };

      this.addVote = function(req, res) {
        console.log("addVote got called");

        console.log(req.body);

        //var refUrlParts = req.url.split('/');
          console.log("bid was " + req.body.bId);
          const bId = parseInt(req.body.bId);
        const userId = req.body.userId;
          const userEmail = req.body.userEmail;
          const userTenantId = req.body.userTenantId;
        const clientType = req.body.clientType;
        const upDown = req.body.upDown;
        var verboseUpDown = "I can repro";
        if (upDown == "down") {
          verboseUpDown = "Cannot repro";
        }

          var query = { "_id": bId };
        var updateOp;
        console.log("upDown is " + upDown);
        console.log("bId is " + bId);
        if (upDown == "up") {
          updateOp = { $addToSet: { "upvotes": userEmail}, $pull: { "downvotes": userEmail} }
        } else {
          updateOp = { $addToSet: { "downvotes": userEmail }, $pull: { "upvotes": userEmail} }
        }

          bugs.findAndModify(
              query,
              {},
              updateOp,
              function (err, result) {
                  if (err) { throw err; }

                  console.log(result);
                  console.log(result[0]);
                  // Now put the vote in VSTS
                  var reqBody = [
                      {
                          op: "add",
                          path: "/fields/System.History",
                          value: userEmail + " (on " + clientType + ") voted: " + verboseUpDown
                      }
                  ];

                  var update_endpoint = TEAMS_ADO_WORKITEM_UPDATE_ENDPOINT.replace("{id}", bId);
                  //console.log(update_endpoint);
                  //console.log(result.value._id);
                  const options = {
                      url: update_endpoint,
                      headers: {
                          'Authorization': AUTH,
                          'Content-Type': 'application/json-patch+json'
                      },
                      body: JSON.stringify(reqBody)
                  };

                  request.patch(options, function (vstsErr, vstsStatus, vstsResponse) {
                      if (vstsErr) { throw vstsErr; }
                      //console.log("Vsts response was: " + vstsResponse);
                      res.json(result.value);
                  });
              });

          //var userQuery = { "email": userEmail };
          //var userData = {
          //    "email": userEmail,
          //    "tenantId": userTenantId,
          //};

          //users.update(userQuery, userData, {
          //    upsert: true
          // }
          //);
        };

    this.getBugsConfig = function (req, res) {

        var alphaSort = { name: 1 };

        var tenantProjection = {
            name: 1,
            tid: 1,
            status: 1,
            parent: 1,
        }

        var activeTenants = {
            status: { $in: ["TAP", "EDU+TAP", "Only Ring 1.5", "TAP(Test Tenant)"] },
            parent: { $exists: false }
        };

        tenants.find(activeTenants).project(tenantProjection).sort(alphaSort).toArray(function (err, tenantDocs) {
            console.log(tenantDocs);
            res.render('bugsConfig', {
                tenants: tenantDocs
            });
        })
    };

    this.getTenantBugsTemplate = function (req, res) {
        var tid = req.params.tid;
        var tenantObj;

        console.log(tid);

        if (tid == "elite") {
            validations.find({ active: true, caseOrder: "normal", tagIsPlaceholder: false, tap: "Teams", test: { $ne: true } }).project({ name: 1, tag: 1 }).sort({ name: 1 }).toArray(function (err, valDocs) {
                res.render('bugs', {
                    elite: true,
                    validations: valDocs,
                });
            })
        } else {
            tenants.findOne({ tid: tid }, {}, function (err, tenantDoc) {
                if (err) {
                    throw err;
                }

                var tenantObj = tenantDoc;

                // Note: This excludes tag-is-placeholder validations, since tagging them wouldn't be useful. Might need to encourage PMs to fix these
                validations.find({ active: true, caseOrder: "normal", tagIsPlaceholder: false, tap: "Teams", test: { $ne: true } }).project({ name: 1, tag: 1 }).sort({ name: 1 }).toArray(function (err, valDocs) {
                    return res.render('bugs', {
                        tenant: tenantObj,
                        validations: valDocs,
                    });
                })
            });
        }
    }

    this.getTenantBugs = function (req, res) {
        console.log("Calling getTenantBugs");
        var tid = req.params.tid;
        var tenantObj;

        let issueWits = [];
        let witsCount = 0;
        let witsDone = false;

        // tids will contain this tenant and child tenants' TIDs
        let tids = [];

        if (tid == "elite") {
            tenants.find({ status: "Elite" }).project({ name: 1, tid: 1 }).toArray(function (err, eliteTenantDocs) {
                console.log(eliteTenantDocs);
                eliteTenantDocs.forEach(function (doc) {
                    tids.push(doc.tid);
                });
                return getBugsForTids(tids);
            });
        } else {
            tids.push(tid);

            tenants.findOne({ tid: tid }, {}, function (err, tenantDoc) {
                if (err) {
                    throw err;
                }

                tenantObj = tenantDoc;
                //console.log(tenantDoc.name);

                tenants.find({ parent: tid }).project({ name: 1, tid: 1, parent: 1 }).toArray(function (err, childDocs) {
                    childDocs.forEach(function (doc) {
                        tids.push(doc.tid);
                    })
                    return getBugsForTids(tids);
                });
            });
        }
        
        function getBugsForTids(tids) {
            console.log("getBugsForTids on:");
            console.log(tids);

            var body = {
                "query": "Select [System.Id] from WorkItems Where [System.WorkItemType] = 'Bug' and [System.CreatedDate] > @today-90 and [System.Tags] Not Contains 'TAPSurvey' and ("
            };

            tids.forEach(function (tid) {
                body.query += ' or ';
                body.query += "[MicrosoftTeamsCMMI.CustomerName] = '" + tid + "'";
            })

            body.query = body.query.replace("( or", '(');
            body.query += ")"

            console.log(body);

            var options = {
                url: QUERY_BY_WIQL_ENDPOINT,
                headers: {
                    'Authorization': AUTH,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            };

            //console.log(options);

            request.post(options, function (vstsErr, vstsStatus, vstsResponse) {
                if (vstsErr) {
                    console.log(vstsErr);
                    throw vstsErr;
                }
                vstsResponse = JSON.parse(vstsResponse);
                //console.log(vstsResponse);
                var workitems = vstsResponse.workItems;
                witsCount = vstsResponse.workItems.length;

                workitems.forEach(function (wit) {

                    var witOptions = {
                        url: wit.url,
                        headers: {
                            'Authorization': AUTH,
                        }
                    }

                    request.get(witOptions, function (vstsErr, vstsStatus, vstsResponse) {
                        // console.log(vstsResponse);

                        let workitem = JSON.parse(vstsResponse);

                        //console.log(workitem);  

                        var commentOptions = {
                            url: wit.url + "/comments?order=asc",
                            headers: {
                                'Authorization': AUTH
                            }
                        };

                        //console.log(commentOptions);

                        request.get(commentOptions, function (commentErr, commentStatus, commentResponse) {

                            let resp = JSON.parse(commentResponse);
                            let comments = resp.comments;

                            // We only want to display comments that are either:
                            // 1) Containing a TAP-Fenix invocation (and are sent to the customer)
                            // 2) Written by TAP-Fenix (Either a Fenix reply, or one of the triage actions from the tenant tab)

                            // (We really just want the number of comments here, the actual comments are fetched from this.getBugComments with ajax)

                            let fenixComments = [];

                            comments.forEach(function (comment) {
                                // Comments coming from dev
                                if (comment.text.includes("TAP-Fenix")) {
                                    fenixComments.push(comment);

                                    // Comments coming from customer, or dev thru tap-fenix
                                } else if (comment.createdBy.uniqueName == "tapfenix@microsoft.com") {
                                    fenixComments.push(comment);
                                }
                            })
                            //workitem.comments = fenixComments;
                            workitem.commentCount = fenixComments.length;


                            issueWits.push(workitem);
                            //console.log(workitem.id == "691157");

                            witsDone += 1;
                            checkIfDone();
                        });
                    })
                })

                // In case there are no workitems
                checkIfDone();
            });
        }

        function checkIfDone() {
            //console.log(witsDone + " / " + witsCount);
            if (witsDone == witsCount) {
                finalRender();
            }
        }

        function finalRender() {
            console.log("Consolidating");

            let simpleBugs = [];

            issueWits.forEach(function (wit) {
                //console.log(wit);

                let shortSteps = wit.fields["Microsoft.VSTS.TCM.ReproSteps"] || "";
                //console.log(shortSteps);

                if (shortSteps.includes("System info")) {
                    shortSteps = shortSteps.split("System info:")[0];
                }


                if (shortSteps.includes("All the logs &amp; screenshots")) {
                    shortSteps = shortSteps.split("All the logs &amp; screenshots")[0];
                }

                // For some mobile bugs
                if (shortSteps.includes("=============================")) {
                    shortSteps = shortSteps.split("=============================")[0];
                }

                if (shortSteps.includes(' style="box-sizing:border-box;"')) {
                    shortSteps = shortSteps.replace(/ style="box-sizing:border-box;"/g, '');
                }


                shortSteps = shortSteps.split("<hr><br>")[1];

                console.log(shortSteps);

                let state = wit.fields["System.State"];
                //console.log(wit.fields["System.Tags"]);
                if (wit.fields["System.Tags"]) {
                    if ((wit.fields["System.Tags"].includes("TAPITAdminRequestingClose")) && (state != "Closed")) {
                        state = "Close Requested";
                    }
                }

                let triaged = false;
                if (wit.fields["System.Tags"]) {
                    if (wit.fields["System.Tags"].includes("TAPITAdminTriaged")) {
                        triaged = true;
                    }
                }

                simpleBugs.push({
                    DT_RowId: wit.id,
                    id: wit.id,
                    date: new Date(wit.fields["System.CreatedDate"]).toLocaleDateString(),
                    title: wit.fields["System.Title"],
                    tags: wit.fields["System.Tags"],
                    state: state,
                    reason: wit.fields["System.Reason"],
                    reproSteps: shortSteps || "",
                    submitter: wit.fields["MicrosoftTeamsCMMI.CustomerEmail"] || "",
                    //statusTweet: wit.fields["MicrosoftTeamsCMMI.StatusTweet"] || "",
                    triaged: triaged,
                    //history: wit.fields["System.History"] || "",
                    //comments: wit.comments,
                    commentCount: wit.commentCount,
                })
            });

            //console.log(simpleBugs);

            res.json({
                tenant: tenantObj,
                bugs: simpleBugs,
                wits: issueWits,
            });
        }
    }

    this.getBugComments = function (req, res) {
        var refUrlParts = req.url.split('/');
        const bId = parseInt(refUrlParts.pop());

        if (bId == null) {
            return res.status(400).send();
        }

        let comments_url = TEAMS_ADO_WORKITEM_COMMENTS_ENDPOINT.replace("{id}", bId);

        var commentOptions = {
            url: comments_url,
            headers: {
                'Authorization': AUTH
            }
        };

        console.log(commentOptions);

        request.get(commentOptions, function (commentErr, commentStatus, commentResponse) {
            let resp = JSON.parse(commentResponse);
            let comments = resp.comments;

            // We only want to display comments that are either:
            // 1) Containing a TAP-Fenix invocation (and are sent to the customer)
            // 2) Written by TAP-Fenix (Either a Fenix reply, or one of the triage actions from the tenant tab)

            let fenixComments = [];

            comments.forEach(function (comment) {
                // Comments coming from dev
                if (comment.text.includes("TAP-Fenix")) {
                    let cleanedComment = cleanComment(comment.text);
                    comment.text = cleanedComment;
                    fenixComments.push(comment);

                    // Comments coming from customer, or dev thru tap-fenix
                } else if (comment.createdBy.uniqueName == "tapfenix@microsoft.com") {
                    let cleanedComment = cleanComment(comment.text);
                    comment.text = cleanedComment;
                    fenixComments.push(comment);
                }
            })
            fenixComments.forEach(function (comment) {
                console.log(comment.text);
            })
            return res.json({ comments: fenixComments });
        });
    }

    this.triageBug = function (req, res) {
        console.log(req.body);

        let rings = req.body.rings;
        let extent = req.body.extent;
        let everWorked = req.body.everWorked;
        let submitter = req.body.submitter;
        let validationName = req.body.validationName;

        let comment_url = "https://dev.azure.com/domoreexp/MSTeams/_apis/wit/workItems/" + req.body.id + "/comments?api-version=5.1-preview.3";
        let modify_wit_url = "https://dev.azure.com/domoreexp/MSTeams/_apis/wit/workitems/" + req.body.id + "?api-version=5.1";

        let getWitOptions = {
            url: modify_wit_url,
            headers: {
                'Authorization': AUTH,
            },
        };

        request.get(getWitOptions, function (vstsErr, vstsStatus, vstsResponse) {
            let resp = JSON.parse(vstsResponse);
            console.log(resp);

            let existingTags = resp.fields["System.Tags"];
            console.log(existingTags);

            let comment = submitter + " provided this triage info through the Tenant Bugs tab:<br />Users affected: " + extent + "<br />Rings this repros in: " + rings + "<br />Has this ever worked? " + everWorked;

            if (validationName) {
                comment += "<br />Validation: " + validationName;
            }

            comment = comment.replace(/\n/g, "<br />");

            var reqBody = {
                text: comment
            }

            var options = {
                url: comment_url,
                headers: {
                    'Authorization': AUTH,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(reqBody)
            };

            request.post(options, function (vstsErr, vstsStatus, vstsResponse) {
                if (vstsErr) { throw vstsErr; }
                console.log(vstsResponse);

                let patch = [];

                let severity = "3 - Medium";
                let priority = 2;
                if (req.body.extent == "Several") {
                    severity = "2 - High";
                } else if (req.body.extent == "All") {
                    severity = "1 - Critical";
                    priority = 1;
                }

                patch.push({
                    op: "add",
                    path: "/fields/Microsoft.VSTS.Common.Severity",
                    value: severity
                });

                // Only need to set priority if extent is All
                if (req.body.extent == "All") {
                    patch.push({
                        op: "add",
                        path: "/fields/Microsoft.VSTS.Common.Priority",
                        value: priority
                    });
                }

                function sendPatch(patch) {
                    console.log(patch);
                    let patchOptions = {
                        url: modify_wit_url,
                        headers: {
                            'Authorization': AUTH,
                            'Content-Type': 'application/json-patch+json'
                        },
                        body: JSON.stringify(patch)
                    }

                    request.patch(patchOptions, function (vstsErr, vstsStatus, vstsResponse) {
                        console.log(vstsErr);
                        console.log(vstsResponse);
                        return res.status(200).send();
                    })
                }

                if (validationName) {
                    validations.findOne({ name: validationName }, { projection: { name: 1, tag: 1 } }, function (err, valDoc) {
                        if (valDoc == null) {
                            console.log("No validation found with name: " + validationName);
                            return res.status(200).send();
                        } else {
                            patch.push({
                                op: "add",
                                path: "/fields/System.Tags",
                                value: existingTags + "; TAPITAdminTriaged; " + valDoc.tag
                            });

                            return sendPatch(patch);
                        }
                    });
                } else {
                    console.log("No validation name provided");
                    patch.push({
                        op: "add",
                        path: "/fields/System.Tags",
                        value: existingTags + "; TAPITAdminTriaged"
                    });

                    return sendPatch(patch);
                }
            });
        });

        
    }

    this.addComment = function (req, res) {
        console.log(req.body);

        let comment = 'IT Admin submitted a comment through the Tenant Bugs tab:<br />"' + req.body.comment + '" - ' + req.body.submitter;
        if (req.body.attachmentFilename) {
            comment += "<br />[Attachment]";
        }

        let modify_wit_url = "https://dev.azure.com/domoreexp/MSTeams/_apis/wit/workitems/" + req.body.id + "?api-version=5.1";

        let getWitOptions = {
            url: modify_wit_url,
            headers: {
                'Authorization': AUTH,
            },
        };

        request.get(getWitOptions, function (vstsErr, vstsStatus, vstsResponse) {
            let resp = JSON.parse(vstsResponse);
            console.log(resp);

            let existingTags = resp.fields["System.Tags"];
            console.log(existingTags);


            let patch = [
                {
                    op: "add",
                    path: "/fields/System.History",
                    value: comment
                }
            ];

            // New tag shows when IT admins have commented
            patch.push({
                op: "add",
                path: "/fields/System.Tags",
                value: existingTags + "; TAPITAdminCommented"
            });

            let patchOptions = {
                url: modify_wit_url,
                headers: {
                    'Authorization': AUTH,
                    'Content-Type': 'application/json-patch+json'
                },
                body: JSON.stringify(patch)
            }

            request.patch(patchOptions, function (vstsErr, vstsStatus, vstsResponse) {
                console.log(vstsResponse);

                // Handle attachments if necessary
                if (req.body.attachmentFilename) {
                    // The attachment is given the filename in req.body.attachmentFilename. It is at uploads/req.body.attachmentFilename.

                    let filePath = path.join(__dirname, '../../uploads', req.body.attachmentFilename);
                    console.log(filePath);

                    fs.readFile(filePath, (err, data) => {
                        if (err) throw err;
                        console.log(data);

                        let cleanContents = data;
                        //console.log(cleanContents);

                        let attachment_endpoint = TEAMS_ADO_ATTACHMENT_CREATE_ENDPOINT + "?fileName=" + req.body.attachmentFilename + "&api-version=4.1";

                        let attachmentOptions = {
                            url: attachment_endpoint,
                            headers: {
                                'Authorization': AUTH,
                                'Content-Type': 'application/octet-stream'
                            },
                            body: cleanContents,
                            encoding: null,
                        }

                        console.log(attachmentOptions);

                        request.post(attachmentOptions, function (adoErr, adoStatus, adoResponse) {
                            if (adoErr) { throw adoErr; }

                            console.log(adoResponse);

                            adoResponse = JSON.parse(adoResponse);
                            let attachmentUrl = adoResponse.url;

                            let linkPatch = [
                                {
                                    "op": "add",
                                    "path": "/relations/-",
                                    "value": {
                                        "rel": "AttachedFile",
                                        "url": attachmentUrl,
                                        "attributes": {
                                            "comment": ""
                                        }
                                    },
                                }
                            ];

                            let linkOptions = {
                                url: TEAMS_ADO_WORKITEM_UPDATE_ENDPOINT.replace('{id}', req.body.id),
                                headers: {
                                    'Authorization': AUTH,
                                    'Content-TYpe': 'application/json-patch+json',
                                },
                                body: JSON.stringify(linkPatch),
                            }

                            request.patch(linkOptions, function (adoErr, adoStatus, adoResponse) {
                                if (adoErr) { throw err; }

                                return res.status(200).send();
                            });

                        });
                    });
                } else {
                    return res.status(200).send();
                }
            });
        })
    }

    function closeBug(req, callback) {
        console.log("Calling closeBug");
        console.log(req.body);

        let comment = 'IT Admin submitted a request to close this bug through the Tenant Bugs tab. The comment was: <br />"' + req.body.comment + '" - ' + req.body.submitter;

        let modify_wit_url = "https://dev.azure.com/domoreexp/MSTeams/_apis/wit/workitems/" + req.body.id + "?api-version=5.1";

        let getWitOptions = {
            url: modify_wit_url,
            headers: {
                'Authorization': AUTH,
            },
        };

        request.get(getWitOptions, function (vstsErr, vstsStatus, vstsResponse) {
            let resp = JSON.parse(vstsResponse);
            console.log(resp);

            let existingTags = resp.fields["System.Tags"];
            console.log(existingTags);

            let patch = [];

            if (req.body.duplicateId) {
                let linkId = parseInt(req.body.duplicateId);
                let duplicatedUrl = "https://domoreexp.visualstudio.com/MSTeams/_workitems/edit/" + linkId

                patch.push({
                    "op": "add",
                    "path": "/relations/-",
                    "value": {
                        "rel": "System.LinkTypes.Duplicate-Reverse",
                        "url": duplicatedUrl
                    }
                });
                comment += "<br />Marked as duplicate of: <a href='" + duplicatedUrl + "'>" + req.body.duplicateId + "</a>";
            }

            patch.push({
                op: "add",
                path: "/fields/System.Tags",
                value: existingTags + "; TAPITAdminRequestingClose"
            });

            patch.push({
                op: "add",
                path: "/fields/System.History",
                value: comment
            })

            let patchOptions = {
                url: modify_wit_url,
                headers: {
                    'Authorization': AUTH,
                    'Content-Type': 'application/json-patch+json'
                },
                body: JSON.stringify(patch)
            }

            request.patch(patchOptions, function (vstsErr, vstsStatus, vstsResponse) {
                console.log(vstsResponse);
                //res.status(200).send();
                return callback();
            })
        });
    }

    this.closeBug = function (req, res) {
        closeBug(req, res.status(200).send());
    }

    this.bulkCloseBugs = function (req, res) {
        function checkIfDone() {
            console.log("Checking if done");
            console.log(counter + " / " + bugCount);
            if (counter == bugCount) {
                return res.status(200).send();
            }
        }

        console.log("Calling closeBug");
        console.log(req.body);

        var counter = 0;
        var bugCount = req.body.ids.length;

        req.body.ids.forEach(function (bugId) {
            // Call closeBug with 
            let params = req;
            params.body.id = bugId;

            closeBug(params, function () {
                console.log("Returned from this function")
                counter++;
                checkIfDone();
            });
        })

    }
}

module.exports = bugHandler;