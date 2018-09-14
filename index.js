#!/usr/bin/env node

const timeoutSeconds = 4
const gpio = require('onoff').Gpio
const relay = new gpio(4, 'out')

const localtunnel = require('localtunnel')
const makePlugin = require('ilp-plugin')
const { Server } = require('ilp-protocol-stream')
const Koa = require('koa')
const app = new Koa()
const crypto = require('crypto')

let paymentPointer

process.on('SIGINT', () => {
  relay.unexport()
})

async function run () {
  console.log('Connecting to moneyd...')
  const streamPlugin = makePlugin()
  await streamPlugin.connect()

  const streamServer = new Server({
    plugin: streamPlugin,
    serverSecret: crypto.randomBytes(32)
  })

  streamServer.on('connection', connection => {
    let thisConnectionTimeout
    let totalDrops = 0
    console.log('+ New connection')
    connection.on('stream', stream => {
      stream.setReceiveMax(1000000000)
      stream.on('money', amount => {
        relay.write(1, (err, r) => {
          if (totalDrops === 0) {
            console.log('<<< Switching ON >>>>')
          }
        })

        clearTimeout(thisConnectionTimeout)
        thisConnectionTimeout = setTimeout(() => {
          totalDrops = Math.max(connection.totalReceived, totalDrops)

          console.log('<<< Switching OFF >>>>')
          relay.write(0, (err, r) => {
            console.log(`# Connection closed`)
            console.log('  > value:', `${totalDrops} = ${totalDrops/1000000} XRP`)
            console.log('  > sourceAccount:', connection.sourceAccount)
            // console.log('  > destinationAccount:', connection.destinationAccount)  
          })
  
          connection.destroy().then(() => { 
            console.log(`  - Connection cleaned up`) 
          }).catch(console.error)
        }, timeoutSeconds * 1000)
        totalDrops += parseInt(amount)
        console.log(`  » Got packet for ${amount} units - Sum: ${Math.max(connection.totalReceived, totalDrops)} drops (${Math.max(connection.totalReceived, totalDrops)/1000000} XRP)`)
      })
    })
  })

  await streamServer.listen()

  console.log('Created Receiver...')
  async function handleSPSP (ctx, next) {
    console.log(`Request at domain ${ctx.host} with path ${ctx.originalUrl}`)

    if (ctx.get('Accept').indexOf('application/spsp4+json') !== -1) {
      const details = streamServer.generateAddressAndSecret() // No tag
      ctx.body = {
        destination_account: details.destinationAccount,
        shared_secret: details.sharedSecret.toString('base64')
      }
      ctx.set('Content-Type', 'application/spsp4+json')
      ctx.set('Access-Control-Allow-Origin', '*')
    } else {
      let endpoint = `: \n    ${paymentPointer || '[ NOT READY YET, AWAITING PAYMENTPOINTER ]'}`
      ctx.status = 404
      ctx.body = `ILP Deposit Endpoint${endpoint}\n\nPlease send ILP payments here.`;
      return next()
    }
  }

  app
    .use(handleSPSP)
    .listen(1337)

  console.log('Listening :)')

  localtunnel(1337, {}, (err, tunnel) => {
    console.log(`Publishing (getting localtunnel hostname)...`)
    if (err) {
      console.error(err)
      process.exit(1)
    }
    paymentPointer = '$' + tunnel.url.split('/')[2]
    console.log(`Payment pointer at: ${paymentPointer}`)
  })
}

run()
  .catch(e => {
    console.error('##ERROR', e)
    process.exit(1)
  })



