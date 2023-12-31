require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_PAYMENT_SECRET_KEY);
// console.log("Stripe API key",stripe, 'Stripe ApI');
const port = process.env.PORT || 3000;

///// Middle Ware /////
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.USER_ID}:${process.env.USER_KEY}@firstpractice.poejscf.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const menuCollection = client.db("bistroBoss").collection("menu");
    const reviewCollection = client.db("bistroBoss").collection("reviews");
    const cartsCollection = client.db("bistroBoss").collection("carts");
    const usersCollection = client.db("bistroBoss").collection("users");
    const paymentsCollection = client.db("bistroBoss").collection("payments");

    ///////// Stripe Payment Start \\\\\\\\

    app.get("/payments/:email", async (req, res) => {
      const query = { email: req.params.email };
      // if (req.params.email !== req.decoded.email) {
      //   return res.status(403).send({ message: "forbidden access" });
      // }
      const history = await paymentsCollection.find(query).toArray();
      res.send(history);
    });

    // User Payment History Post server
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentsCollection.insertOne(payment);

      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        },
      };
      const deleteResult = await cartsCollection.deleteMany(query);
      res.send({ paymentResult, deleteResult });
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    //////// Admin Route Manage Item Function Start \\\\\\\\\

    // Using aggregate pipeline
    app.get("/orderStates", async (req, res) => {
      const result = await paymentsCollection
        .aggregate([
          {
            $unwind: "$menuItemIds",
          },
          {
            $lookup: {
              from: "menu",
              localField: "menuItemIds",
              foreignField: "_id",
              as: "menusItem",
            },
          },
          {
            $unwind: "$menusItem",
          },
          // {
          //   $group: {
          //     _id: '$menusItem.category',
          //     quantity:{ $sum: 1 },
          //     revenue: { $sum: '$menusItem.price'} 
          //   }
          // },
          // {
          //   $project: {
          //     _id: 0,
          //     category: '$_id',
          //     quantity: '$quantity',
          //     revenue: '$revenue'
          //   }
          // }
        ])
        .toArray();

      res.send(result);
    });

    // States and analytics
    app.get("/adminStates", async (req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentsCollection.estimatedDocumentCount();

      const result = await paymentsCollection
        .aggregate([
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: "$price",
              },
            },
          },
        ])
        .toArray();

      const revenue = result.length > 0 ? result[0].totalRevenue : 0;
      res.send({ users, menuItems, orders, revenue });
    });
    ////////// Stripe Payment End \\\\\\\\\

    app.delete("/api/menus/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/api/menus/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.findOne(query);
      res.send(result);
    });

    app.patch("/api/menus/:id", async (req, res) => {
      const menu = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          name: menu.name,
          price: menu.price,
          category: menu.category,
          recipe: menu.recipe,
          image: menu.image,
        },
      };
      const result = await menuCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //////// Admin Route Manage Item Function End \\\\\\\\\

    /// JWT Related \\\
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.SECRET_JWT, { expiresIn: "24h" });
      res.send({ token });
    });

    /// Verify Middle War
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.SECRET_JWT, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    /// Verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // User Collection
    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteMany(query);
      res.send(result);
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    /// Admin secure API
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req?.params?.email;
      if (email !== req?.decoded?.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      /// Add Google Sign In Function
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exist", insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Carts Collection
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartsCollection.insertOne(cartItem);
      res.send(result);
    });

    app.get("/api/menus", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post("/api/menus", async (req, res) => {
      const items = req.body;
      const result = await menuCollection.insertOne(items);
      res.send(result);
    });

    app.get("/api/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello bistro-boss!");
});

app.listen(port, () => {
  console.log(`Bistro Boss Server listening on port ${port}`);
});
