var express = require('express');
var moment = require('moment');
var router = express.Router();


function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    next();
  } else {
    // var my_error = new Error("Unauthorized behaviro");
    // my_error.status = 401;
    // next(my_error);
    // 
    res.status(401).send("Unauthorized action, login required");
  }
}

function processReqUser ( req_user){  
  if (req_user) var temp_user = req_user.toObject();
  else return null;
  delete temp_user.password_hash; 
  return temp_user;
}

function genPostId(){
  var currentDate = new Date();
  var post_id = (currentDate.getFullYear()%2000).toString() + (currentDate.getMonth()+1).toString() + currentDate.getDay().toString() + currentDate.getHours().toString();
  post_id += currentDate.getMinutes().toString() + currentDate.getSeconds().toString() + currentDate.getMilliseconds().toString();
  return post_id;
}
// callback of promise catch
function thisError(err){
  return next(err);
}

function sanityCheckPosts(posts){
  if ( typeof(posts)==='undefined' || posts ===null){
    return -3;
  }
  var i = 0;
  for (i=0; i < posts.length; i++){
    var post = posts[i];
    if (post.role === 1){
      if (typeof (post['last_reply']) === 'undefined'){
        return -2;
      }
    }
    if  (typeof (post['poster']) === 'undefined'){
      return -1;
    }
  }
  return 1;
}

/*routes
get    "/"
//********* Q & A **********
get    "/qa"
post   "/qa/question?qid=xxxx"
get    "/qa/question?qid=xxxxx"
post   "/qa/posting"
get    "/qa/[pstomh"

//********* Ant Activity **********


*/

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { 
    title: 'FASIDS',
    activePage:'Home',
    isAuthenticated: req.isAuthenticated(),
    user: processReqUser(req.user)
  });
});

/*visit the qa forum*/
router.get('/qa', function (req, res, next){
  req.DB_POST.getAllMainPosts(function (err, posts){
    if (err) {return next(err);}
    if (!posts) {return next(new Error("did not find posts"));}
    toBeRenderedPosts = [];
    if (posts.length === 0){
      res.render('qa', {title:'Question and Answers | FASIDS',
        breadcrumTitle:"Interactive Questions and Answers",
        pathToHere:"qa",
        activePage:'Questions',
        isAuthenticated: req.isAuthenticated(),
        user: processReqUser(req.user),
        posts:toBeRenderedPosts
      });
      return;
    }
    req.DB_POST.staticLinkPostWithUser(posts).then(  req.DB_POST.staticLinkLastReply.bind(req.DB_POST)  ).then(function (processed_posts){
      var sanityCheckSig =   sanityCheckPosts(processed_posts)
      if ( sanityCheckSig !== 1){
          return next(new Error("posts sanity check failed with code: " + sanityCheckSig));
      }
      res.render('qa', {title:'Question and Answers | FASIDS',
        breadcrumTitle:"Interactive Questions and Answers",
        pathToHere:"qa",
        activePage:'Questions',
        isAuthenticated: req.isAuthenticated(),
        user: processReqUser(req.user),
        posts:processed_posts,
        momentlib:moment
      }).catch(function(err){
        return next(err);
      });
    });
    // console.log("qa rendered");
  });
});

router.post('/qa/question', function (req, res, next) {
  var reply = {
    role:2,
    post_id:genPostId(),
    poster_id: req.user._id,
    poster_fullname: req.user.displayName(),
    post_time: new Date(),
    reply_to_post: (req.query.replyto)?req.query.replyto:"none",
    reply_to_mainpost:req.query.qid,
    content: req.body.content
  };
  reply = new req.DB_POST(reply);
  reply.save( function (error){
    if (error) return next(error);
    // at current scope, reply is saved successfully 

    req.DB_POST.getAllFollowUps(req.query.qid,function setReplyNumber(err , replies){
      if (err) return next(err);
      req.DB_POST.findOne({post_id: req.query.qid}, null, {}, function (err, main_post){
        if (err) return next(err);
        main_post.updateData(replies.length, replies[replies.length-1]);

      });
    });
    return res.redirect('/qa/question?qid='+req.query.qid);
  });
});

/* /qa/question?qid=123  */
router.get('/qa/question',function (req, res, next){
  // console.log(req.query.qid);
  if (!req.query.qid){
    return next( new Error('illegal queries'));
  }
  var post_id = req.query.qid;
  req.DB_POST.findOne({post_id:post_id},null,{}, function (err, target_post){
    if (err) next(err);
    //Converts this document into a plain javascript object, ready for storage in MongoDB.


    target_post.addOneView();
    req.DB_POST.staticLinkPostWithUser([target_post]).then(function (result){
      var result = result[0];
      req.DB_POST.getAllFollowUps(result.post_id, function whenRepliesReady (err, replies){
        if (err) throw err;
        // var number_reply = replies.length;
        res.render('question.jade',{
          breadcrumTitle:target_post.post_title,
          pathToHere:"qa / question?qid="+post_id.toString(),
          title: 'QA QUESTION | FASIDS',
          activePage:'Questions',
          isAuthenticated: req.isAuthenticated(),
          user: processReqUser(req.user),
          momentlib:moment,
          main_post: result,
          replies:replies,
        });
      });
    }).catch(thisError);

  });
});

/*
  "role":Number, // 1 means main_post, 2 means reply
  "post_id":String,
  "poster_id":mongoose.Schema.ObjectId,
  "post_cat":{type:Number, min:0, max:4},   // used for the icons
  "post_title":String,
  "post_time": Date,
  "reply_to_post":String,// post created to reply specific post
  "reply_to_mainpost":String,
  "content":String
*/
router.post('/qa/posting', ensureAuthenticated, function (req, res, next){
  console.log("$$$$$$posting:$$$");
  var currentDate = new Date();
  var post_id = genPostId();
  var newPost = {
    role:1,
    post_id:post_id,
    poster_id: req.user._id,
    post_cat:(req.body.post_cat)?parseInt(req.body.post_cat):1,
    post_title:req.body.title,
    post_time:currentDate,
    post_viewed:0,
    replied_post:0,
    last_reply_id:post_id,  // last reply is itself, when this is just posted
    content: req.body.content,
    poster_fullname: req.user.displayName()
  };
  newPost = new req.DB_POST(newPost);
  newPost.save( function (error){
    if (error) return next(error);
    return res.redirect('/qa');
  });
});

router.get('/qa/posting', ensureAuthenticated,function (req, res, next){
  res.render('postquestion',{
    breadcrumTitle:"POST A NEW QUESTION",
    pathToHere:"qa / posting",
    title: 'QA POSTING | FASIDS',
    activePage:'Questions',
    isAuthenticated: req.isAuthenticated(),
    user: processReqUser(req.user)
  });
});


/* anti activity */
router.get('/antactivity', function (req, res, next){
  res.render("antactivity",{
    breadcrumTitle:"FIREANT ACTIVITY FORECAST",
    pathToHere:"antactivity",
    activePage:'Ants',
    momentlib:moment
  })
});

/*map applications */
router.get('/landscape/homeownermng', function (req, res, next) {
  res.render("landscape/homeownermng.jade",{
    isAuthenticated: req.isAuthenticated(),
    user: processReqUser(req.user)
  });
});

var field_name_map = {"imt": "IMT", "broadcast":"Broadcast"};

router.get('/landscape/treatment/:geojson_id', ensureAuthenticated, function (req, res, next){
  res.send( "You are requesting geojson_id: "+req.params.geojson_id + ", I will implement this page later");
});


router.post('/landscape/treatment', ensureAuthenticated, function (req, res,next){
  var geojson = req.body.geojson;
  if (typeof req.body.geojson == "string"){
    geojson = JSON.parse(geojson);
  }

  geojson.properties.owner = req.user._id;
  var db_geojson = new req.db_models.PolygonGeojson(geojson);
  db_geojson.save();
  // var geojson = {"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[-96.329777,30.619817],[-96.326988,30.619319],[-96.330721,30.616807],[-96.331773,30.618672],[-96.329777,30.619817]]]},"properties":{"prop0":"value0","prop1":"value1","landusage":"lawnturf","treatment":"imt","total_area":73543.85682681292,"mound_density":5,"bounds":{"sw":{"lat":30.61680733107116,"lng":-96.33177280426025},"ne":{"lat":30.61981729366712,"lng":-96.32698774337769}}}};
  // geojson.properties.mound_density = 5;
  // geojson.properties.total_area = 5000;
  geojson.properties.treatment = field_name_map[geojson.properties.treatment ];

  req.db_models.FireAntProduct.find( { "usage": geojson.properties.treatment}, null, {}, function exec(error, products){
    if (error) return next(error);
    //** TODO I have geojson here, I need to use the information to retireve corresponding products
    // do simple calculation here
    products.forEach(function iteratee (product, index, al){
      products[index].amount= product.getAmount(geojson.properties.total_area, geojson.properties.mound_density);
    });

    res.render('landscape/treatment.jade',{
      geojson:geojson,
      products: products,
      breadcrumTitle:"LAND TREATMENT",
      pathToHere:"landscape / treatment",
      isAuthenticated: req.isAuthenticated(),
      user: processReqUser(req.user)
    }); 
  });


});
/* this route is used to display products*/
router.get('/landscape/fire_ant_products', function(req, res, next){
  req.db_models.FireAntProduct.find({},null,{}, function exec(error, products ){
    if (error) return next(error);
    
    res.render(("landscape/fire_ant_products.jade"),{
      breadcrumTitle:"FIRE ANT PRODUCTS",
      pathToHere:"landscape / fire_ant_products",
      activePage:'Landscape',
      products: products,
      isAuthenticated: req.isAuthenticated(),
      user: processReqUser(req.user)
    });
  });
});

module.exports = router;
