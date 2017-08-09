/**
 * function to be triggered by a Contentful webhook if changes are applied to
 * an Entry through Contentful's management API.
 *
 * Event flow:
 *
 * 1. Parse the incoming data and headers from Contentful
 * 2. Use Contentful's management API to resolve a user id to a user name
 * 3. Format a message compatible with Slack's incoming webhooks
 * 4. Post to Slack
 * @param event AWS event data.
 * @param context AWS Lambda uses this parameter to provide your handler the runtime
 *        information of the Lambda function that is executing.
 * @param callback Optional callback to return information to the caller.
 */

// Load the axios http lib.
var axios = require('axios')
var express = require('express')
var bodyParser = require('body-parser')
var app = express()

app.use(bodyParser.json({type: ['application/*+json', 'application/json']}))
app.set('port', (process.env.PORT || 5000))

// The URL of your incoming webhook at slack,
const slackURL = process.env.slackURL
// A valid content management token.
const cmaToken = process.env.cmaToken

var body, type, id, cmaURL, contentfulDeeplinkURL, slackMessageTemplate

// Maps URL fragments to types.
const typeUrlMap = {
  'Entry': 'entries',
  'Asset': 'assets',
  'ContentType': 'content_types'
}

app.all('/', (request, response) => {
  // console.log('Request headers:', request.headers)
  // console.log('Request body:', request.body)

  // The body of the entity (Entry / ContentType).
  body = request.body
  const id = body.sys.id
  const spaceId = body.sys.space.sys.id
  // The type of the entity (Entry / ContentType).
  const type = body.sys.type
  const webhook_name = request.headers['x-contentful-webhook-name']
  const webhook_topic = request.headers['x-contentful-topic']

  // We only want to post to slack if an entry is changed.
  if (type != 'Entry') {
    response.status(200).send('I am only posting entries to slack!')
    return
  }

  // URL pattern of the CMA endpoint.
  cmaURL = `https://api.contentful.com/spaces/${spaceId}/`
  // Path to deeplink to the entity changed.
  contentfulDeeplinkURL = `https://app.contentful.com/spaces/${spaceId}/${typeUrlMap[type]}/${id}`

  // Message template following the slack specification:
  // https://api.slack.com/docs/formatting
  slackMessageTemplate = {
    'username': `Webhook: ${webhook_name}`,
    'icon_emoji': ':contentful:',
    'attachments': [{
      'fallback': '',
      'pretext': '',
      'color': '#000000',
      'fields': [
        {
          'title': 'Action applied to Entry',
          'value': webhook_topic,
          'short': false
        }
      ]
    }]
  }

  /*
   * 1. get the userId
   * 2. getTheName of the user
   * 3. post final message to slack
   */
  getUserId().
  then(getUserName).
  then(postToSlack).
  then(() => {
    response.status(200).send('Slack post successful!')
  }).catch((error) => {
    console.log('error', error)
    response.status(500).send(error)
  })
})


/**
 * The structure of the body of the payload follows th convention of our APIs. That means
 * if an action does affect the Delivery API (e.g. publish), the body will not contain the
 * id of the user who applied the change. If an action does affect the Management API
 * (e.g. auto_save), the body will contain the id of the user who applied the change.
 */
function getUserId() {
  // console.log('getting user id')
  // Do not ask the CMA for user id if already present in body.
  if (body.sys.updatedBy !== undefined) {
    return Promise.resolve(body.sys.updatedBy.sys.id)
  }

  return axios({
    url: cmaURL + typeUrlMap[type] + '/' + id,
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + cmaToken
    }
  }).then(response => response.data.sys.updatedBy.sys.id
  ).catch(error => {
    throw error
  })
}


/**
 * Request the user name from CMA.
 * @param userId Id of the user.
 * @returns {axios.Promise}
 */
function getUserName(userId) {
  // console.log('getting user name')
  return axios({
    url: cmaURL + 'users/',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + cmaToken
    }
  }).then(response => {
    var users = response.data.items.filter(user => {
      return user.sys.id == userId
    })
    var userName = users[0].firstName + ' ' + users[0].lastName
    // console.log('getUserName', userName)
    return userName
  }).catch(function (error) {
    throw error
  })
}


/**
 * Post final message to slack webhook.
 * @param userName Username.
 * @returns {*|axios.Promise}
 */
function postToSlack(userName) {
  // console.log('postToSlack')

  var message = `An Entry has just been changed by ${userName}. The full Entry is below in the fields. Here is the link to the entry: <${contentfulDeeplinkURL}|Link to ${body.sys.type}>`

  // Append all fields to post.
  for (var key in body.fields) {
    slackMessageTemplate.attachments[0].fields.push({
      'title': 'field.' + key,
      'value': body.fields[key]['en-US'],
      short: false
    })
  }

  slackMessageTemplate.attachments[0].fallback = message
  slackMessageTemplate.attachments[0].pretext = message
  // console.log(JSON.stringify(slackMessageTemplate))
  return axios({
    url: slackURL,
    method: 'POST',
    data: JSON.stringify(slackMessageTemplate)
  })
}

app.listen(app.get('port'), () => {
  console.log('Node app is running on port', app.get('port'))
})
